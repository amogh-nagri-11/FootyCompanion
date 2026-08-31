import { cacheGetJson, cacheSetJson } from '../redis.js';
import { fetchLiveFixtures, fetchUpcomingFixtures, MatchSummary } from './sportsApi.js';

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
