import { config } from '../config.js';
import { redis } from '../redis.js';
import { MatchEvent } from './sportsApi.js';

/**
 * Live momentum: who is currently dominating play, judged by recent event
 * density rather than the scoreline. A side two goals up but pinned in their
 * own half should not read as dominant.
 *
 * Deliberately computed from the events the poller already has (goals, cards,
 * substitutions). Shots on target would be a better signal, but it lives on a
 * separate statistics endpoint and would cost another API call per poll against
 * a 100/day quota — that is a scope cut, not an oversight.
 */

/**
 * HEURISTIC STARTING POINT — these weights are a judgement call, not derived
 * from data. They encode "a goal says far more about who is on top than a
 * substitution does", nothing more. Retune once there is match data to fit
 * against; nothing else in the module depends on their exact values.
 */
const EVENT_WEIGHTS: Record<MatchEvent['type'], number> = {
  goal: 4,
  card: 1.5,
  substitution: 1,
  other: 0.5,
};

/** Only events inside this trailing window count toward momentum. */
export const WINDOW_MINUTES = 12;

/**
 * Half-life of an event's contribution within the window, in minutes. At 4
 * minutes a goal scored 8 minutes ago carries a quarter of the weight of one
 * scored just now, so momentum decays smoothly instead of falling off a cliff
 * when an event leaves the window.
 */
const HALF_LIFE_MINUTES = 4;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MINUTES;

export interface Momentum {
  /** 0-100, and home + away always sum to 100. */
  home: number;
  away: number;
  /** Raw decayed weight per side, before normalising — useful for debugging. */
  raw: { home: number; away: number };
  /** How many events actually fed this figure. */
  eventCount: number;
  windowMinutes: number;
}

/** A 50/50 split, used before anything has happened. */
function neutral(eventCount = 0): Momentum {
  return {
    home: 50,
    away: 50,
    raw: { home: 0, away: 0 },
    eventCount,
    windowMinutes: WINDOW_MINUTES,
  };
}

/**
 * Momentum as of `currentMinute`, from the match's accumulated event log.
 *
 * Goals and substitutions credit the team that made them. **Cards credit the
 * opposition.** Players get booked when they are under pressure — fouling to
 * stop a counter, chasing the game — so a run of bookings against one side is
 * evidence the *other* side is on top, and a red card makes that literal by
 * leaving them a man short. Crediting a card to the booked team reads a side
 * being overrun as a side with momentum.
 *
 * This is not universal: dissent, time-wasting while protecting a lead, and
 * celebration bookings all cut the other way. It is the better model on
 * balance, not a rule without exceptions.
 */
export function calculateMomentum(
  events: MatchEvent[],
  currentMinute: number,
  homeTeam: string,
  awayTeam: string
): Momentum {
  if (events.length === 0) return neutral();

  let home = 0;
  let away = 0;
  let counted = 0;

  for (const event of events) {
    const age = currentMinute - event.minute;

    // Ignore anything outside the window. A small negative age is tolerated:
    // stoppage-time events can carry a minute ahead of the reported clock.
    if (age > WINDOW_MINUTES || age < -1) continue;

    const weight = EVENT_WEIGHTS[event.type] ?? EVENT_WEIGHTS.other;
    const decayed = weight * Math.exp(-DECAY_LAMBDA * Math.max(age, 0));

    // A card counts for whoever it was NOT shown to; everything else counts
    // for whoever did it.
    const isCard = event.type === 'card';
    let creditsHome: boolean;

    if (event.team === homeTeam) creditsHome = !isCard;
    else if (event.team === awayTeam) creditsHome = isCard;
    else continue; // Unattributable event — neither side gets credit.

    if (creditsHome) home += decayed;
    else away += decayed;

    counted++;
  }

  const total = home + away;
  if (total === 0) return neutral(counted);

  const homeShare = Math.round((home / total) * 100);

  return {
    home: homeShare,
    // Derive the away share by subtraction so the pair always sums to exactly
    // 100 — rounding both independently can produce 49/50 or 51/50.
    away: 100 - homeShare,
    raw: { home: Number(home.toFixed(3)), away: Number(away.toFixed(3)) },
    eventCount: counted,
    windowMinutes: WINDOW_MINUTES,
  };
}


const momentumKey = (matchId: string) => `match:${matchId}:momentum`;

/**
 * Persists the current momentum for a match.
 *
 * Momentum is recomputed from the event log on every poll, so this is not
 * needed for the poll loop itself. It exists for the gap either side of it: a
 * reader who opens a match between polls, or a server that has just restarted,
 * would otherwise see an empty bar until the next event.
 */
export async function storeMomentum(matchId: string, momentum: Momentum): Promise<void> {
  try {
    await redis.set(
      momentumKey(matchId),
      JSON.stringify(momentum),
      'EX',
      config.seenEventsTtlSeconds
    );
  } catch {
    // Momentum is a nicety; failing to cache it must not fail the poll.
  }
}

/** Last stored momentum, or null when nothing is held or Redis is unreachable. */
export async function loadMomentum(matchId: string): Promise<Momentum | null> {
  try {
    const raw = await redis.get(momentumKey(matchId));
    return raw ? (JSON.parse(raw) as Momentum) : null;
  } catch {
    return null;
  }
}
