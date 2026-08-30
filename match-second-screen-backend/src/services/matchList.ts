import { redis } from '../redis.js';
import { fetchLiveFixtures, MatchSummary } from './sportsApi.js';

const CACHE_KEY = 'matches:live';
// The list screen is hit on every page load and each miss costs one upstream
// request against a 100/day quota, so serve a short-lived shared snapshot
// rather than calling the API per viewer.
const CACHE_TTL_SECONDS = 60;

export async function getLiveFixtures(): Promise<{
  matches: MatchSummary[];
  cached: boolean;
}> {
  const hit = await redis.get(CACHE_KEY);
  if (hit) {
    return { matches: JSON.parse(hit) as MatchSummary[], cached: true };
  }

  const matches = await fetchLiveFixtures();
  await redis.set(CACHE_KEY, JSON.stringify(matches), 'EX', CACHE_TTL_SECONDS);
  return { matches, cached: false };
}
