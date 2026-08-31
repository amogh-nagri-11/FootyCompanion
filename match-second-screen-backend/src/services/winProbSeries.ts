import { redis } from '../redis.js';
import { config } from './../config.js';
import { calculateWinProbability } from './winProbability.js';

type WinProb = ReturnType<typeof calculateWinProbability>;

export interface WinProbSample {
  minute: number;
  home: number;
  draw: number;
  away: number;
}

/**
 * Win probability over the course of a match, one sample per match minute.
 *
 * Live in Redis, keyed per match under the same prefix and TTL as the
 * seen-events set; copied into Postgres at full time by the archiver. That
 * follows the existing split — live data in Redis, finished-match data in
 * Postgres — rather than writing a row to Postgres on every poll.
 */
function key(matchId: string): string {
  return `match:${matchId}:winprob_series`;
}

/**
 * Records a sample, at most one per match minute.
 *
 * The poller runs several times per match minute, so appending unconditionally
 * would store long runs of identical samples and make a "largest single-step
 * change" meaningless. One sample per minute makes each step a real minute of
 * football.
 */
export async function recordWinProb(
  matchId: string,
  minute: number,
  winProb: WinProb
): Promise<void> {
  const seriesKey = key(matchId);
  const last = await redis.lindex(seriesKey, -1);

  if (last) {
    const previous = JSON.parse(last) as WinProbSample;
    if (previous.minute === minute) return;
  }

  const sample: WinProbSample = {
    minute,
    home: winProb.home,
    draw: winProb.draw,
    away: winProb.away,
  };

  await redis.rpush(seriesKey, JSON.stringify(sample));
  await redis.expire(seriesKey, config.seenEventsTtlSeconds);
}

export async function getWinProbSeries(matchId: string): Promise<WinProbSample[]> {
  const raw = await redis.lrange(key(matchId), 0, -1);
  return raw
    .map((entry) => JSON.parse(entry) as WinProbSample)
    .sort((a, b) => a.minute - b.minute);
}

export async function clearWinProbSeries(matchId: string): Promise<void> {
  await redis.del(key(matchId));
}
