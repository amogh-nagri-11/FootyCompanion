import { redis } from '../redis.js';
import { config } from '../config.js';
import { fetchLiveMatch, MatchEvent, LiveMatchState } from './sportsApi.js';
import { calculateWinProbability } from './winProbability.js';
import { archiveMatch } from './archive.js';
import { calculateMomentum, Momentum } from './momentum.js';
import { recordWinProb, getWinProbSeries, clearWinProbSeries } from './winProbSeries.js';
import { findTurningPoint } from './turningPoint.js';
import { generateMatchSummary } from './matchSummary.js';

type WinProb = ReturnType<typeof calculateWinProbability>;

type EventCallback = (
  matchId: string,
  newEvents: MatchEvent[],
  state: LiveMatchState,
  winProb: WinProb,
  momentum: Momentum
) => void;

const activePolls = new Map<string, NodeJS.Timeout>();
const consecutiveFailures = new Map<string, number>();
const lastBroadcast = new Map<string, string>();
const lastKnownState = new Map<
  string,
  { state: LiveMatchState; winProb: WinProb; momentum: Momentum }
>();
// Every event seen this polling session. The real API returns the full list on
// each poll, but the mock returns only what just happened — accumulating here
// means history and the archive are correct for either source.
const accumulatedEvents = new Map<string, MatchEvent[]>();

/**
 * The most recent state seen for a match, used to bring a client that joins
 * mid-match up to date. Undefined until the first successful poll.
 */
export function getLastKnownState(matchId: string) {
  return lastKnownState.get(matchId);
}

function recordPollFailure(matchId: string, err: unknown) {
  const failures = (consecutiveFailures.get(matchId) ?? 0) + 1;
  consecutiveFailures.set(matchId, failures);
  console.error(
    `Poll error for ${matchId} (${failures}/${config.maxConsecutivePollFailures}):`,
    err instanceof Error ? err.message : err
  );

  if (failures >= config.maxConsecutivePollFailures) {
    console.error(`Giving up on ${matchId} after ${failures} consecutive failures.`);
    stopPolling(matchId);
  }
}

//designed to poll the api every 10 seconds because of limit constraints 
//if no limit constraints polling should match the api's data refresh rate
async function pollOnce(matchId: string, onNewEvents: EventCallback) {
  console.log(`Polling ${matchId}...`); // temporary
  const state = await fetchLiveMatch(matchId);
  consecutiveFailures.delete(matchId);

  const seenKey = `match:${matchId}:seen_events`;
  const seenIds: string[] = await redis.smembers(seenKey);
  const seenSet = new Set(seenIds);

  const newEvents = state.events.filter((e) => !seenSet.has(e.id));

  const prior = accumulatedEvents.get(matchId) ?? [];
  const priorIds = new Set(prior.map((e) => e.id));
  const history = [...prior, ...state.events.filter((e) => !priorIds.has(e.id))];
  accumulatedEvents.set(matchId, history);

  if (newEvents.length > 0) {
    await redis.sadd(seenKey, ...newEvents.map((e) => e.id));
  }

  // Broadcast whenever there is something new to say — fresh events, or a
  // change to the clock, score or status. Sending only on new events was
  // enough for the mock, whose 90th-minute goal happened to coincide with
  // full time, but on a real match it freezes the displayed minute through
  // any quiet spell and means a match that ends without a simultaneous event
  // never reaches clients as "finished".
  const signature = `${state.minute}|${state.homeScore}-${state.awayScore}|${state.status}`;
  const winProb = calculateWinProbability(state);

  // Momentum is derived from events we already hold — no extra API call.
  const momentum = calculateMomentum(history, state.minute, state.homeTeam, state.awayTeam);

  // Record the probability alongside the match clock. Stored every poll rather
  // than only on new events, because the turning point is found by comparing
  // consecutive minutes and gaps in the series would hide swings.
  await recordWinProb(matchId, state.minute, winProb);

  // Cached per match under the same key prefix and TTL discipline as the
  // seen-events set, so a restarted server or a late joiner can be served the
  // last known momentum without waiting for the next event.
  await redis.set(
    `match:${matchId}:momentum`,
    JSON.stringify(momentum),
    'EX',
    config.seenEventsTtlSeconds
  );

  lastKnownState.set(matchId, { state: { ...state, events: history }, winProb, momentum });

  // The very first broadcast of a polling session carries the whole event
  // list, not just the delta. Redis remembers events across restarts, so a
  // match resumed with a warm `seen_events` set would otherwise send a
  // scoreboard with an empty feed — clients dedupe by id, so resending is safe.
  const isFirstBroadcast = !lastBroadcast.has(matchId);
  if (newEvents.length > 0 || isFirstBroadcast || lastBroadcast.get(matchId) !== signature) {
    lastBroadcast.set(matchId, signature);
    onNewEvents(matchId, isFirstBroadcast ? history : newEvents, state, winProb, momentum);
  }

  // Slide the expiry forward on every poll rather than only when events are
  // written. A goalless stretch can easily outlast any sane TTL, and letting
  // the set expire mid-match would make every past event look new and get
  // re-broadcast. Expiring on an absent key is a no-op.
  await redis.expire(seenKey, config.seenEventsTtlSeconds);

  if (state.status === 'finished') {
    // Persist before tearing down the poll — this is the last time we hold the
    // full event list for this match.
    await finaliseMatch(matchId, state, history);
    stopPolling(matchId);
  }

  return state;
}

/**
 * End-of-match work: locate the turning point in the stored probability series,
 * have it narrated, and archive the result.
 *
 * The turning point is computed here, deterministically, and handed to the
 * summariser — the model is never asked to work out which moment mattered.
 */
async function finaliseMatch(
  matchId: string,
  state: LiveMatchState,
  history: MatchEvent[]
): Promise<void> {
  try {
    const series = await getWinProbSeries(matchId);
    const turningPoint = findTurningPoint(series, history);
    const { summary, generated } = await generateMatchSummary(state, history, turningPoint);

    await archiveMatch({ ...state, events: history }, history, summary, turningPoint);

    if (!generated) {
      console.log(`Used templated summary for ${matchId} (no LLM provider or call failed).`);
    }
    await clearWinProbSeries(matchId);
  } catch (err) {
    console.error(
      `Failed to finalise ${matchId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export function startPolling(
  matchId: string,
  onNewEvents: EventCallback,
  intervalMs = config.pollIntervalMs
) {
  if (activePolls.has(matchId)) return;

  consecutiveFailures.delete(matchId);
  lastBroadcast.delete(matchId);
  pollOnce(matchId, onNewEvents).catch((err) => recordPollFailure(matchId, err));

  const timer = setInterval(() => {
    pollOnce(matchId, onNewEvents).catch((err) => recordPollFailure(matchId, err));
  }, intervalMs);

  activePolls.set(matchId, timer);
}

export function stopPolling(matchId: string) {
  const timer = activePolls.get(matchId);
  if (timer) {
    clearInterval(timer);
    activePolls.delete(matchId);
  }
  consecutiveFailures.delete(matchId);
  lastBroadcast.delete(matchId);
  lastKnownState.delete(matchId);
  accumulatedEvents.delete(matchId);
}