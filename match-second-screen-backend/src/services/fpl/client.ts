import { cacheGetJson, cacheSetJson } from '../../redis.js';

const BASE = 'https://fantasy.premierleague.com/api';

/*
 * Cache TTLs. FPL rate-limits under hammering, so every endpoint is fetched
 * once and fanned out to all subscribers rather than fetched per user:
 *  - bootstrap is a ~1MB master list that changes at most daily
 *  - live points change as matches play, but no faster than the match poller
 *  - picks are frozen once a gameweek deadline passes
 */
const BOOTSTRAP_TTL = 6 * 60 * 60;
const LIVE_TTL = 45;
const PICKS_TTL = 15 * 60;

export interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number;
}

export interface FplTeam {
  id: number;
  name: string;
  short_name: string;
}

export interface FplEvent {
  id: number;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
}

export interface Bootstrap {
  elements: FplElement[];
  teams: FplTeam[];
  events: FplEvent[];
}

export interface LiveElement {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    yellow_cards: number;
    red_cards: number;
    bonus: number;
    total_points: number;
  };
}

export interface Pick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface Picks {
  active_chip: string | null;
  entry_history: { event: number; points: number; total_points: number };
  picks: Pick[];
}

export class FplError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FplError';
    this.status = status;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    // FPL serves a challenge page to clients with no user agent.
    headers: { 'User-Agent': 'LiveXI/1.0' },
  });

  if (res.status === 404) throw new FplError(`Not found: ${path}`, 404);
  if (res.status === 429) throw new FplError('FPL is rate limiting us. Try again shortly.', 429);
  if (!res.ok) throw new FplError(`FPL request failed (${res.status})`, res.status);

  return (await res.json()) as T;
}

/**
 * Read-through Redis cache. A cached value survives restarts and is shared by
 * every subscriber. An unreachable cache reports a miss, so FPL is hit more
 * often than we would like rather than the panel failing outright.
 */
async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGetJson<T>(key);
  if (hit !== null) return hit;

  const value = await load();
  await cacheSetJson(key, value, ttlSeconds);
  return value;
}

export function getBootstrap(): Promise<Bootstrap> {
  return cached('fpl:bootstrap', BOOTSTRAP_TTL, () => fetchJson<Bootstrap>('/bootstrap-static/'));
}

export async function getCurrentGameweek(): Promise<number | null> {
  const { events } = await getBootstrap();
  // Between gameweeks nothing is current; fall back to the upcoming one so the
  // UI can still show the squad the user has selected.
  return (events.find((e) => e.is_current) ?? events.find((e) => e.is_next))?.id ?? null;
}

export async function getLivePoints(gameweek: number): Promise<Map<number, LiveElement>> {
  const data = await cached(`fpl:live:${gameweek}`, LIVE_TTL, () =>
    fetchJson<{ elements: LiveElement[] }>(`/event/${gameweek}/live/`)
  );
  return new Map(data.elements.map((e) => [e.id, e]));
}

export async function getPicks(entryId: number, gameweek: number): Promise<Picks> {
  return cached(`fpl:picks:${entryId}:${gameweek}`, PICKS_TTL, () =>
    fetchJson<Picks>(`/entry/${entryId}/event/${gameweek}/picks/`)
  );
}

/** Confirms an entry id exists before we store it against a user. */
export async function entryExists(entryId: number): Promise<boolean> {
  try {
    await fetchJson(`/entry/${entryId}/`);
    return true;
  } catch (err) {
    if (err instanceof FplError && err.status === 404) return false;
    throw err;
  }
}
