import 'dotenv/config';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of seconds, got: ${raw}`);
  }
  return Math.floor(value);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  databaseUrl: required('DATABASE_URL'),
  supabaseJwtSecret: required('SUPABASE_JWT_SECRET'),
  redisUrl: required('REDIS_URL'),
  apiFootballKey: required('API_FOOTBALL_KEY'),
  apiFootballHost: required('API_FOOTBALL_HOST'),
  useMockSportsData: process.env.USE_MOCK_SPORTS_DATA === 'true',
  // How long a match's seen-events set outlives the last poll. Refreshed on
  // every poll, so this only has to cover the gap between a match going quiet
  // and the set becoming safe to drop — not the length of a match.
  // Comma-separated list of browser origins allowed to call the REST routes.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  seenEventsTtlSeconds: positiveInt('SEEN_EVENTS_TTL_SECONDS', 7200),
  // API-Football refreshes fixture data every 15s, so polling faster buys
  // nothing and burns quota: one match at 15s is ~240 requests/hour, already
  // over the free tier's 100/day. Tune to the plan before running real matches.
  pollIntervalMs: positiveInt('POLL_INTERVAL_MS', 15000),
  // A hot retry loop against a failing API (bad key, exhausted quota) is worse
  // than going quiet, so give up on a match after this many consecutive errors.
  maxConsecutivePollFailures: positiveInt('MAX_CONSECUTIVE_POLL_FAILURES', 5),
};