import { config } from '../config.js';
import { redis, redisReady } from '../redis.js';

/**
 * One shared budget for every upstream API-Football request.
 *
 * The plan's limit is per account per day, but nothing in the app knew that:
 * each polled match ran its own timer and spent from the same pot without
 * looking, so two matches at a 90s interval used twice the budget of one, and
 * a handful of simultaneous matches with real viewers would exhaust the day
 * before half of them finished.
 *
 * Every call now takes a ticket first. The counter lives in Redis keyed by UTC
 * day, so it is shared across matches and survives a restart, and it expires on
 * its own rather than needing a reset job.
 *
 * Reservations are split by purpose. Polling a live match is the one thing that
 * must not be starved by browsing, so interactive requests (the fixture list, a
 * stats panel) are cut off while polling still has room. Without that split a
 * busy afternoon of browsing would silently kill the live feed.
 */

export type QuotaPurpose = 'poll' | 'interactive';

/** Kept for the day plus an hour, so a spend near midnight is not lost early. */
const KEY_TTL_SECONDS = 25 * 60 * 60;

function dayKey(): string {
  return `apiquota:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Share of the daily budget that only polling may spend. Interactive requests
 * stop at the remaining 70%; polls may use the whole thing.
 */
const POLL_RESERVE_FRACTION = 0.3;

export interface QuotaState {
  limit: number;
  used: number;
  remaining: number;
  /** Ceiling this purpose may spend up to, after the poll reserve. */
  interactiveCeiling: number;
}

export class QuotaExhaustedError extends Error {
  purpose: QuotaPurpose;
  state: QuotaState;

  constructor(purpose: QuotaPurpose, state: QuotaState) {
    super(
      purpose === 'interactive'
        ? `Daily football-data budget is spent down to the live-match reserve (${state.used}/${state.limit} used today). Live scores keep updating; other views resume tomorrow.`
        : `Daily football-data budget is exhausted (${state.used}/${state.limit} used today).`
    );
    this.name = 'QuotaExhaustedError';
    this.purpose = purpose;
    this.state = state;
  }
}

async function readUsed(): Promise<number> {
  if (!redisReady()) return 0;
  const raw = await redis.get(dayKey());
  return Number(raw) || 0;
}

export async function quotaState(): Promise<QuotaState> {
  const limit = config.apiDailyRequestLimit;
  const used = await readUsed();
  return {
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    interactiveCeiling: Math.floor(limit * (1 - POLL_RESERVE_FRACTION)),
  };
}

/**
 * Claims one request against today's budget, or throws.
 *
 * Increment-then-check rather than check-then-increment: two callers racing
 * would both pass a read-first check and both spend. INCR is atomic, so the
 * loser sees the over-limit value and hands its ticket back.
 *
 * When Redis is unreachable this allows the call. An unreachable cache already
 * degrades this app to "slower and more expensive", and blocking every request
 * on a cache outage would turn a soft failure into a hard one — the upstream
 * enforces its own limit regardless, and that failure is now surfaced.
 */
export async function claimRequest(purpose: QuotaPurpose): Promise<void> {
  if (!redisReady()) return;

  const limit = config.apiDailyRequestLimit;
  const ceiling =
    purpose === 'poll' ? limit : Math.floor(limit * (1 - POLL_RESERVE_FRACTION));

  const key = dayKey();
  const used = await redis.incr(key);
  // Only the first write of the day needs the expiry.
  if (used === 1) await redis.expire(key, KEY_TTL_SECONDS);

  if (used > ceiling) {
    await redis.decr(key);
    throw new QuotaExhaustedError(purpose, {
      limit,
      used: used - 1,
      remaining: Math.max(limit - (used - 1), 0),
      interactiveCeiling: Math.floor(limit * (1 - POLL_RESERVE_FRACTION)),
    });
  }
}

/**
 * Poll interval that fits the number of matches actually being watched.
 *
 * A fixed interval is the wrong shape: one match at 90s is comfortable, six at
 * 90s is 3,840 requests a day against a budget of 100. This spreads the poll
 * share of the budget across the live matches and the hours they run, and never
 * polls faster than the configured floor.
 */
export function pollIntervalFor(activeMatches: number, limit = config.apiDailyRequestLimit): number {
  const matches = Math.max(activeMatches, 1);
  const pollBudget = Math.max(Math.floor(limit * POLL_RESERVE_FRACTION), 1);
  // Assume the watched matches are spread over a six-hour window of play.
  const windowSeconds = 6 * 60 * 60;
  const perMatchRequests = Math.max(Math.floor(pollBudget / matches), 1);
  const spacing = Math.ceil(windowSeconds / perMatchRequests) * 1000;

  return Math.max(spacing, config.pollIntervalMs);
}
