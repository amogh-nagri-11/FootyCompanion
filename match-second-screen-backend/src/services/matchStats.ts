import { cacheGetJson, cacheSetJson } from '../redis.js';
import { fetchMatchStats, MatchStats } from './sportsApi.js';

/**
 * Cached access to the expensive half of a match.
 *
 * `fetchMatchStats` costs three upstream calls, and the free plan allows 100 a
 * day, so the cache is the feature: without it a handful of curious users
 * browsing one afternoon would exhaust the quota for everyone.
 *
 * The TTL is chosen by whether the match can still change. A finished match is
 * immutable — its xG and player ratings are settled — so it is held for a day,
 * and repeat views of an archived match cost nothing. A live match is refreshed
 * often enough to feel current but not so often that one open tab burns the
 * budget on its own.
 */
const FINISHED_TTL_SECONDS = 24 * 60 * 60;
const LIVE_TTL_SECONDS = 120;

const key = (matchId: string) => `matchstats:${matchId}`;

export interface CachedMatchStats extends MatchStats {
  cached: boolean;
}

export async function getMatchStats(
  matchId: string,
  finished: boolean
): Promise<CachedMatchStats> {
  const hit = await cacheGetJson<MatchStats>(key(matchId));
  if (hit) return { ...hit, cached: true };

  const stats = await fetchMatchStats(matchId);

  // Don't cache a wholly empty result for a day: fixtures often publish their
  // lineup an hour before kickoff and their statistics only once play starts,
  // so an early miss would otherwise pin an empty panel in place until tomorrow.
  const empty = !stats.available.stats && !stats.available.lineups && !stats.available.players;
  const ttl = empty ? LIVE_TTL_SECONDS : finished ? FINISHED_TTL_SECONDS : LIVE_TTL_SECONDS;

  await cacheSetJson(key(matchId), stats, ttl);
  return { ...stats, cached: false };
}
