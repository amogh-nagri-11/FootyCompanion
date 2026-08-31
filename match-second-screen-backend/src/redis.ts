import { Redis } from 'ioredis';
import { config } from './config.js';

/*
 * ioredis holds commands in an offline queue while the connection is down. The
 * queue itself is wanted — it is what lets a command issued in the second
 * between boot and the first connect still succeed — but its default is to
 * retry forever, so with no server reachable a `get` never settles and every
 * request that touches the cache hangs indefinitely rather than failing.
 *
 * `maxRetriesPerRequest` bounds that: after this many reconnect attempts the
 * queue is flushed with an error instead of waiting. The cache helpers below
 * additionally race every command against a deadline, so a cache read can
 * never hold a request open no matter how ioredis is behaving.
 */
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  connectTimeout: 2000,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
});

// One line per outage rather than one per retry: the strategy above reconnects
// every few seconds forever, which would otherwise bury every other log.
const ERROR_LOG_INTERVAL_MS = 30_000;
let lastErrorLoggedAt = 0;
let down = false;

redis.on('error', (err) => {
  down = true;
  const now = Date.now();
  if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLoggedAt = now;
  console.error(
    `Redis unavailable at ${config.redisUrl} — caches will fall through to their upstream:`,
    err instanceof Error ? err.message : err
  );
});

redis.on('ready', () => {
  if (down) console.log('Redis reconnected.');
  down = false;
  lastErrorLoggedAt = 0;
});

/**
 * Longest a cache lookup may delay the request it is meant to speed up. Well
 * clear of a healthy local round trip, short enough that a dead cache is not
 * felt as a stall.
 */
const CACHE_TIMEOUT_MS = 1000;

function withTimeout<T>(op: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    // A rejected command (queue flushed, connection refused) is a miss too.
    op.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), CACHE_TIMEOUT_MS).unref()),
  ]);
}

/**
 * Read-through cache helpers for data that is merely *expensive* to recompute.
 *
 * They degrade to a miss on any failure or delay, so an unreachable Redis costs
 * an extra upstream call rather than an error or a hang. Do not use them where
 * Redis holds state (the poller's seen-event set, the win-probability series):
 * there a silent miss is not a slower answer but a wrong one, so those call
 * sites keep letting the error surface.
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const hit = await withTimeout<string | null>(redis.get(key), null);
  if (!hit) return null;

  try {
    return JSON.parse(hit) as T;
  } catch {
    // A corrupt entry should be re-fetched, not thrown at the caller.
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  // Nothing to do on failure: the value was served, it just will not be cached.
  await withTimeout(redis.set(key, JSON.stringify(value), 'EX', ttlSeconds), 'skipped');
}
