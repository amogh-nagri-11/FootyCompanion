import { config } from '../config.js';
import { cacheGetJson, cacheSetJson } from '../redis.js';
import {
  fetchFixturesByDate,
  fetchLiveFixtures,
  fetchUpcomingFixtures,
  isIsoDate,
  MatchSummary,
  todayUtc,
} from './sportsApi.js';

const LIVE_KEY = 'matches:live';
const UPCOMING_KEY = 'matches:upcoming';

// The list screen is hit on every page load and each miss costs one upstream
// request against a 100/day quota, so serve a short-lived shared snapshot
// rather than calling the API per viewer.
const LIVE_TTL_SECONDS = 60;
// Kickoff times barely move, and this list is only fetched when nothing is in
// play, so it can be cached far longer than the live one. The fallback costs up
// to two upstream calls, which at 60s would be the whole daily quota by teatime.
const UPCOMING_TTL_SECONDS = 900;

/** Which list the client is looking at, so it can label the screen. */
export type FixtureKind = 'live' | 'upcoming';

export interface FixtureList {
  matches: MatchSummary[];
  cached: boolean;
  kind: FixtureKind;
}

async function cached(
  key: string,
  ttl: number,
  load: () => Promise<MatchSummary[]>
): Promise<{ matches: MatchSummary[]; cached: boolean }> {
  // A cache failure reports a miss, so an unreachable Redis makes this screen
  // slower and more expensive against the API quota, never broken.
  const hit = await cacheGetJson<MatchSummary[]>(key);
  if (hit) return { matches: hit, cached: true };

  const matches = await load();
  await cacheSetJson(key, matches, ttl);
  return { matches, cached: false };
}

/**
 * Live fixtures, falling back to the next kickoffs when nothing is in play —
 * an empty screen is the one state that makes the app look broken rather than
 * quiet. The empty live result is still cached, so the fallback does not turn
 * every page load into two upstream calls.
 */
export async function getFixtures(): Promise<FixtureList> {
  const live = await cached(LIVE_KEY, LIVE_TTL_SECONDS, fetchLiveFixtures);
  if (live.matches.length > 0) return { ...live, kind: 'live' };

  const upcoming = await cached(UPCOMING_KEY, UPCOMING_TTL_SECONDS, fetchUpcomingFixtures);
  return { ...upcoming, kind: 'upcoming' };
}

// ---------------------------------------------------------------------------
// Browsing by date
// ---------------------------------------------------------------------------

/**
 * A past day's fixtures never change again, so they are held long enough that
 * scrolling back through the week costs one upstream call per day, once. Today
 * is still in motion (scores, kickoffs, postponements) and a future day can
 * still gain fixtures, so both get a short life.
 */
const PAST_DATE_TTL_SECONDS = 24 * 60 * 60;
const TODAY_TTL_SECONDS = 60;
const FUTURE_DATE_TTL_SECONDS = 15 * 60;

function ttlForDate(date: string): number {
  const today = todayUtc();
  if (date < today) return PAST_DATE_TTL_SECONDS;
  if (date === today) return TODAY_TTL_SECONDS;
  return FUTURE_DATE_TTL_SECONDS;
}

export interface DatedFixtureList {
  matches: MatchSummary[];
  cached: boolean;
  date: string;
  /** Inclusive range the client may navigate, so it can cap its own controls. */
  window: { from: string; to: string };
}

/** Shifts a YYYY-MM-DD by whole days without tripping over month ends. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fixtureDateWindow(): { from: string; to: string } {
  const today = todayUtc();
  const span = config.fixtureDateWindowDays;
  return { from: shiftDate(today, -span), to: shiftDate(today, span) };
}

/** Raised for a date the plan will refuse, so the route can answer 400 not 502. */
export class DateOutOfRangeError extends Error {
  window: { from: string; to: string };

  constructor(window: { from: string; to: string }) {
    super(
      `That date is outside the range this API plan allows (${window.from} to ${window.to}).`
    );
    this.name = 'DateOutOfRangeError';
    this.window = window;
  }
}

/** Every fixture on one UTC day, whatever its state. */
export async function getFixturesForDate(date: string): Promise<DatedFixtureList> {
  if (!isIsoDate(date)) throw new Error(`Invalid date '${date}', expected YYYY-MM-DD`);

  // Checked before the request rather than after: walking outside the plan's
  // window is a certainty, not a maybe, and a wasted call costs 1% of the day.
  const window = fixtureDateWindow();
  if (date < window.from || date > window.to) throw new DateOutOfRangeError(window);

  const { matches, cached: fromCache } = await cached(`matches:date:${date}`, ttlForDate(date), () =>
    fetchFixturesByDate(date)
  );
  return { matches, cached: fromCache, date, window };
}
