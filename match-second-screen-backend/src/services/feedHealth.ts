/**
 * Why a match feed has stopped updating, so the UI can say so.
 *
 * A stale scoreboard is indistinguishable from a quiet match: nothing on the
 * screen changes either way. Previously a bad key, an exhausted quota or an
 * abandoned poll produced only a server-side log line, and the reader was left
 * looking at a score that had silently stopped being true.
 */

export type FeedStatus = 'ok' | 'degraded' | 'quota' | 'stopped';

export interface FeedHealth {
  status: FeedStatus;
  /** Reader-facing sentence. Null when everything is fine. */
  message: string | null;
  /** Consecutive failures behind the current status. */
  failures: number;
  /** When the feed last updated successfully (ISO), if it ever has. */
  lastUpdate: string | null;
}

const health = new Map<string, FeedHealth>();

const OK: FeedHealth = { status: 'ok', message: null, failures: 0, lastUpdate: null };

export function getFeedHealth(matchId: string): FeedHealth {
  return health.get(matchId) ?? OK;
}

export function recordSuccess(matchId: string): FeedHealth | null {
  const prior = health.get(matchId);
  const next: FeedHealth = {
    status: 'ok',
    message: null,
    failures: 0,
    lastUpdate: new Date().toISOString(),
  };
  health.set(matchId, next);

  // Only worth broadcasting when it is news — a recovery, not every poll.
  return prior && prior.status !== 'ok' ? next : null;
}

/**
 * Classifies a poll failure into something a reader can act on.
 *
 * The three cases differ in what the reader should do: wait (transient), wait
 * until tomorrow (quota), or stop expecting updates at all (given up).
 */
export function recordFailure(
  matchId: string,
  err: unknown,
  failures: number,
  gaveUp: boolean
): FeedHealth {
  const raw = err instanceof Error ? err.message : String(err);
  const lastUpdate = health.get(matchId)?.lastUpdate ?? null;

  let status: FeedStatus = gaveUp ? 'stopped' : 'degraded';
  let message: string;

  if (/quota|budget|rate limit|429/i.test(raw)) {
    status = 'quota';
    message =
      "Live updates paused — today's football-data budget is used up. Scores resume tomorrow.";
  } else if (/rejected the key|401|403|invalid api key/i.test(raw)) {
    // Deliberately not surfacing which credential or why: that is an operator
    // problem, and the detail belongs in the log, not on a stranger's screen.
    status = gaveUp ? 'stopped' : 'degraded';
    message = 'Live updates are unavailable — the match feed rejected our request.';
  } else if (gaveUp) {
    message = 'Live updates stopped after repeated errors. Reload to try again.';
  } else {
    message = 'Live updates are having trouble — the score below may be behind.';
  }

  const next: FeedHealth = { status, message, failures, lastUpdate };
  health.set(matchId, next);
  return next;
}

export function clearFeedHealth(matchId: string): void {
  health.delete(matchId);
}
