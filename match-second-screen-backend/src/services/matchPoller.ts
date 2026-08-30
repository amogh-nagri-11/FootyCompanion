import { redis } from '../redis.js';
import { fetchLiveMatch, MatchEvent, LiveMatchState } from './sportsApi.js';
import { calculateWinProbability } from './winProbability.js';

type EventCallback = (matchId: string, newEvents: MatchEvent[], state: LiveMatchState, winProb: ReturnType<typeof calculateWinProbability>) => void;

const activePolls = new Map<string, NodeJS.Timeout>();

//designed to poll the api every 10 seconds because of limit constraints 
//if no limit constraints polling should match the api's data refresh rate
async function pollOnce(matchId: string, onNewEvents: EventCallback) {
  console.log(`Polling ${matchId}...`); // temporary
  const state = await fetchLiveMatch(matchId);

  const seenKey = `match:${matchId}:seen_events`;
  const seenIds: string[] = await redis.smembers(seenKey);
  const seenSet = new Set(seenIds);

  const newEvents = state.events.filter((e) => !seenSet.has(e.id));

  if (newEvents.length > 0) {
    await redis.sadd(seenKey, ...newEvents.map((e) => e.id));
    const winProb = calculateWinProbability(state);
    onNewEvents(matchId, newEvents, state, winProb);
  }

  if (state.status === 'finished') {
    stopPolling(matchId);
  }

  return state;
}

export function startPolling(matchId: string, onNewEvents: EventCallback, intervalMs = 10000) {
  if (activePolls.has(matchId)) return;

  pollOnce(matchId, onNewEvents).catch((err) => console.error(`Poll error for ${matchId}:`, err));

  const timer = setInterval(() => {
    pollOnce(matchId, onNewEvents).catch((err) => console.error(`Poll error for ${matchId}:`, err));
  }, intervalMs);

  activePolls.set(matchId, timer);
}

export function stopPolling(matchId: string) {
  const timer = activePolls.get(matchId);
  if (timer) {
    clearInterval(timer);
    activePolls.delete(matchId);
  }
}