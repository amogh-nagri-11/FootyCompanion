import { config } from '../config.js';

export interface MatchEvent {
  id: string;
  matchId: string;
  minute: number;
  type: 'goal' | 'card' | 'substitution' | 'other';
  team: string;
  detail: string;
}

export interface LiveMatchState {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status: 'live' | 'finished' | 'not_started';
  events: MatchEvent[];
}

const mockMatchState = new Map<string, { minute: number; homeScore: number; awayScore: number }>();

async function fetchMockLiveMatch(matchId: string): Promise<LiveMatchState> {
  if (!mockMatchState.has(matchId)) {
    mockMatchState.set(matchId, { minute: 0, homeScore: 0, awayScore: 0 });
  }

  const state = mockMatchState.get(matchId)!;
  state.minute += 2; // advance ~2 mock-minutes per poll

  const events: MatchEvent[] = [];

  // deterministic: a goal every 15 minutes, alternating teams
  if (state.minute > 0 && state.minute % 10 === 0 && state.minute <= 90) {
    const team = (state.minute / 15) % 2 === 0 ? 'Chelsea' : 'Arsenal';
    if (team === 'Arsenal') state.homeScore++; else state.awayScore++;

    events.push({
      id: `evt-${matchId}-${state.minute}`,
      matchId,
      minute: state.minute,
      type: 'goal',
      team,
      detail: 'Mock goal event',
    });
  }

  return {
    matchId,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    minute: Math.min(state.minute, 90),
    status: state.minute >= 90 ? 'finished' : 'live',
    events,
  };
}

/**
 * Shape of the parts of the API-Football v3 `/fixtures?id=` payload we read.
 * Everything is optional: the API omits fields rather than nulling them in
 * some states (a not-started fixture has no events, `goals` are null before
 * kickoff), and a payload we cannot read should degrade, not throw.
 */
interface ApiFixture {
  fixture?: {
    id?: number;
    status?: { short?: string; elapsed?: number | null; extra?: number | null };
  };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  goals?: { home?: number | null; away?: number | null };
  events?: ApiEvent[];
}

interface ApiEvent {
  time?: { elapsed?: number | null; extra?: number | null };
  team?: { name?: string };
  player?: { name?: string | null };
  assist?: { name?: string | null };
  type?: string;
  detail?: string;
  comments?: string | null;
}

interface ApiFixturesResponse {
  errors?: unknown;
  results?: number;
  response?: ApiFixture[];
}

function isRapidApi(): boolean {
  return config.apiFootballHost.includes('rapidapi.com');
}

/**
 * The same API is reachable two ways and they are not interchangeable:
 * RapidAPI namespaces it under /v3 and authenticates with the X-RapidAPI-*
 * pair, while the direct api-sports host encodes the version in the hostname
 * (so a /v3 prefix 404s) and wants x-apisports-key. Pick by host so either
 * key/host pair in .env just works.
 */
function apiUrl(path: string): string {
  return `https://${config.apiFootballHost}${isRapidApi() ? '/v3' : ''}/${path}`;
}

function apiHeaders(): Record<string, string> {
  return isRapidApi()
    ? {
        'X-RapidAPI-Key': config.apiFootballKey,
        'X-RapidAPI-Host': config.apiFootballHost,
      }
    : { 'x-apisports-key': config.apiFootballKey };
}

// https://www.api-football.com/documentation-v3 — fixture.status.short
const NOT_STARTED_CODES = new Set(['TBD', 'NS']);
const LIVE_CODES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
// PST/CANC/ABD are not "finished" in any sporting sense, but they are terminal:
// mapping them here is what lets the poller stop instead of billing the API
// every 15s forever for a match that will never resume.
const FINISHED_CODES = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);

function mapStatus(short: string | undefined): LiveMatchState['status'] {
  if (!short) return 'not_started';
  if (NOT_STARTED_CODES.has(short)) return 'not_started';
  if (LIVE_CODES.has(short)) return 'live';
  if (FINISHED_CODES.has(short)) return 'finished';
  // An unrecognised code is more likely a new in-play state than a finished
  // one, and calling a live match over is the worse error of the two.
  console.warn(`Unknown API-Football status code "${short}", treating as live`);
  return 'live';
}

function mapEventType(type: string | undefined): MatchEvent['type'] {
  switch ((type ?? '').toLowerCase()) {
    case 'goal':
      return 'goal';
    case 'card':
      return 'card';
    case 'subst':
      return 'substitution';
    default:
      // Covers "Var" and anything the API adds later.
      return 'other';
  }
}

function slug(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * API-Football events carry no id, but the poller dedupes on one and Redis
 * remembers it, so it has to be derived from the event's own content and be
 * identical on every poll. Ordinals disambiguate genuinely identical events
 * in the same payload (two bookings in the same minute with no player named);
 * they are stable because the API returns events in a consistent order.
 */
function buildEventId(matchId: string, event: ApiEvent, ordinals: Map<string, number>): string {
  const base = [
    matchId,
    event.time?.elapsed ?? 0,
    event.time?.extra ?? 0,
    slug(event.type),
    slug(event.detail),
    slug(event.team?.name),
    slug(event.player?.name),
  ].join('-');

  const seen = (ordinals.get(base) ?? 0) + 1;
  ordinals.set(base, seen);
  return seen === 1 ? base : `${base}-${seen}`;
}

/** The feed shows this verbatim, so it has to read as a sentence, not a code. */
function describeEvent(event: ApiEvent): string {
  const player = event.player?.name?.trim() || null;
  const assist = event.assist?.name?.trim() || null;
  const detail = event.detail?.trim() || event.type?.trim() || 'Event';

  switch (mapEventType(event.type)) {
    case 'goal':
      if (!player) return detail;
      return assist ? `${player} (${detail}), assist ${assist}` : `${player} — ${detail}`;
    case 'card':
      return player ? `${player} — ${detail}` : detail;
    case 'substitution':
      // API-Football reports the arriving player in `player` and the departing
      // one in `assist`.
      if (player && assist) return `${player} on for ${assist}`;
      return player ? `${player} on` : detail;
    default:
      return event.comments?.trim() ? `${detail} — ${event.comments.trim()}` : detail;
  }
}

function mapFixture(matchId: string, fixture: ApiFixture): LiveMatchState {
  const status = mapStatus(fixture.fixture?.status?.short);
  const ordinals = new Map<string, number>();

  const events: MatchEvent[] = (fixture.events ?? []).map((event) => ({
    id: buildEventId(matchId, event, ordinals),
    matchId,
    // Stoppage time arrives split across elapsed/extra; the feed wants one number.
    minute: (event.time?.elapsed ?? 0) + (event.time?.extra ?? 0),
    type: mapEventType(event.type),
    // Must match homeTeam/awayTeam exactly — the client colours events by name.
    team: event.team?.name ?? 'Unknown',
    detail: describeEvent(event),
  }));

  return {
    matchId,
    homeTeam: fixture.teams?.home?.name ?? 'Home',
    awayTeam: fixture.teams?.away?.name ?? 'Away',
    homeScore: fixture.goals?.home ?? 0,
    awayScore: fixture.goals?.away ?? 0,
    // Stoppage time is reported separately from elapsed (90 + 5, not 95).
    minute: (fixture.fixture?.status?.elapsed ?? 0) + (fixture.fixture?.status?.extra ?? 0),
    status,
    events,
  };
}

async function fetchRealLiveMatch(matchId: string): Promise<LiveMatchState> {
  const res = await fetch(apiUrl(`fixtures?id=${encodeURIComponent(matchId)}`), {
    headers: apiHeaders(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new Error(
        `API-Football rate limit reached (429). Raise POLL_INTERVAL_MS or upgrade the plan. ${body.slice(0, 200)}`
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `API-Football rejected the key (${res.status}) for host ${config.apiFootballHost}. ` +
          `Check API_FOOTBALL_KEY matches the host: RapidAPI keys only work on *.rapidapi.com, ` +
          `api-sports keys only on v3.football.api-sports.io. ${body.slice(0, 200)}`
      );
    }
    throw new Error(`API-Football request failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as ApiFixturesResponse;

  // Logical failures (bad key, unknown parameter, exhausted quota) come back as
  // HTTP 200 with a populated `errors` field, so status alone is not enough.
  const errors = data.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Boolean(errors) && Object.keys(errors as object).length > 0;
  if (hasErrors) {
    throw new Error(`API-Football returned errors: ${JSON.stringify(errors)}`);
  }

  const fixture = data.response?.[0];
  if (!fixture) {
    throw new Error(`No fixture found for id "${matchId}" — check the fixture id.`);
  }

  return mapFixture(matchId, fixture);
}

export async function fetchLiveMatch(matchId: string): Promise<LiveMatchState> {
  return config.useMockSportsData
    ? fetchMockLiveMatch(matchId)
    : fetchRealLiveMatch(matchId);
}