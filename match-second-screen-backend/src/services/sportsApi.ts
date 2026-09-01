import { config } from '../config.js';

export interface MatchEvent {
  id: string;
  matchId: string;
  minute: number;
  type: 'goal' | 'card' | 'substitution' | 'other';
  team: string;
  detail: string;
  /**
   * Raw participant names, kept alongside the rendered `detail` sentence so
   * consumers (FPL matching) never have to parse names back out of prose.
   */
  playerName?: string | null;
  assistName?: string | null;
}

export interface LiveMatchState {
  matchId: string;
  /** Kickoff time (ISO), when the source provides one. */
  kickoff?: string;
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
    date?: string;
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
    playerName: event.player?.name?.trim() || null,
    assistName: event.assist?.name?.trim() || null,
  }));

  return {
    matchId,
    kickoff: fixture.fixture?.date,
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

/** One row in the match-list screen. */
export interface MatchSummary {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status: LiveMatchState['status'];
  league: string | null;
  country: string | null;
  /** Kickoff time (ISO). Present for upcoming fixtures; the client formats it. */
  kickoff: string | null;
}

interface ApiFixtureWithLeague extends ApiFixture {
  league?: { name?: string; country?: string };
}

function toSummary(fixture: ApiFixtureWithLeague): MatchSummary {
  return {
    matchId: String(fixture.fixture?.id ?? ''),
    homeTeam: fixture.teams?.home?.name ?? 'Home',
    awayTeam: fixture.teams?.away?.name ?? 'Away',
    homeScore: fixture.goals?.home ?? 0,
    awayScore: fixture.goals?.away ?? 0,
    minute:
      (fixture.fixture?.status?.elapsed ?? 0) + (fixture.fixture?.status?.extra ?? 0),
    status: mapStatus(fixture.fixture?.status?.short),
    league: fixture.league?.name ?? null,
    country: fixture.league?.country ?? null,
    kickoff: fixture.fixture?.date ?? null,
  };
}

async function fetchMockLiveFixtures(): Promise<MatchSummary[]> {
  return ['test789', 'test123'].map((matchId, i) => ({
    matchId,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    homeScore: i,
    awayScore: 0,
    minute: 10 + i * 20,
    status: 'live' as const,
    league: 'Mock League',
    country: 'Mockland',
    kickoff: null,
  }));
}

async function fetchMockUpcomingFixtures(): Promise<MatchSummary[]> {
  const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  return [
    ['mock-up-1', 'Liverpool', 'Everton', 45],
    ['mock-up-2', 'Real Madrid', 'Barcelona', 150],
  ].map(([matchId, homeTeam, awayTeam, inMinutes]) => ({
    matchId: matchId as string,
    homeTeam: homeTeam as string,
    awayTeam: awayTeam as string,
    homeScore: 0,
    awayScore: 0,
    minute: 0,
    status: 'not_started' as const,
    league: 'Mock League',
    country: 'Mockland',
    kickoff: soon(inMinutes as number),
  }));
}

/** GET /fixtures?<query>, with the two failure modes this API has folded in. */
async function fetchFixtureList(query: string, label: string): Promise<MatchSummary[]> {
  const res = await fetch(apiUrl(`fixtures?${query}`), { headers: apiHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API-Football ${label} request failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as ApiFixturesResponse;
  const errors = data.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Boolean(errors) && Object.keys(errors as object).length > 0;
  if (hasErrors) {
    throw new Error(`API-Football returned errors: ${JSON.stringify(errors)}`);
  }

  return (data.response ?? []).map(toSummary).filter((m) => m.matchId);
}

async function fetchRealLiveFixtures(): Promise<MatchSummary[]> {
  return fetchFixtureList('live=all', 'live fixtures');
}

/** YYYY-MM-DD in UTC, which is the calendar the API's `date` filter uses. */
function utcDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * The list screen is worth showing even when nothing is in play, so this backs
 * it with the next kickoffs instead.
 *
 * `next=N` would be the natural call but it is a paid-plan parameter, so this
 * pages by UTC day and filters to kickoffs still ahead of us. Late in the UTC
 * day that leaves almost nothing, hence the roll-over into tomorrow — capped at
 * two upstream calls because the free plan allows only 100 a day.
 */
const UPCOMING_MIN_RESULTS = 12;
const UPCOMING_MAX_RESULTS = 100;

async function fetchRealUpcomingFixtures(): Promise<MatchSummary[]> {
  const now = Date.now();
  const ahead = (list: MatchSummary[]) =>
    list.filter((m) => m.kickoff && Date.parse(m.kickoff) > now);

  let fixtures = ahead(await fetchFixtureList(`date=${utcDate()}&status=NS`, 'upcoming fixtures'));

  if (fixtures.length < UPCOMING_MIN_RESULTS) {
    fixtures = fixtures.concat(
      ahead(await fetchFixtureList(`date=${utcDate(1)}&status=NS`, 'upcoming fixtures'))
    );
  }

  return fixtures
    .sort((a, b) => Date.parse(a.kickoff!) - Date.parse(b.kickoff!))
    .slice(0, UPCOMING_MAX_RESULTS);
}

export async function fetchLiveFixtures(): Promise<MatchSummary[]> {
  return config.useMockSportsData ? fetchMockLiveFixtures() : fetchRealLiveFixtures();
}

export async function fetchUpcomingFixtures(): Promise<MatchSummary[]> {
  return config.useMockSportsData ? fetchMockUpcomingFixtures() : fetchRealUpcomingFixtures();
}

export async function fetchLiveMatch(matchId: string): Promise<LiveMatchState> {
  return config.useMockSportsData
    ? fetchMockLiveMatch(matchId)
    : fetchRealLiveMatch(matchId);
}
// ---------------------------------------------------------------------------
// Fixtures for an arbitrary calendar day
// ---------------------------------------------------------------------------

/** True when `value` is a plain YYYY-MM-DD date, which is all the API accepts. */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Today in UTC — the calendar the API's `date` filter uses. */
export function todayUtc(): string {
  return utcDate();
}

async function fetchMockFixturesByDate(date: string): Promise<MatchSummary[]> {
  const live = await fetchMockLiveFixtures();
  return live.map((m) => ({ ...m, matchId: `${m.matchId}-${date}`, kickoff: `${date}T15:00:00+00:00` }));
}

/**
 * Every fixture on one UTC day, whatever its state — the date browser shows
 * finished, in-play and upcoming side by side, so unlike the live list this
 * deliberately does not filter by status.
 */
export async function fetchFixturesByDate(date: string): Promise<MatchSummary[]> {
  if (!isIsoDate(date)) throw new Error(`Invalid date '${date}', expected YYYY-MM-DD`);
  if (config.useMockSportsData) return fetchMockFixturesByDate(date);
  return fetchFixtureList(`date=${date}`, `fixtures for ${date}`);
}

// ---------------------------------------------------------------------------
// Match detail: team statistics, lineups, player ratings
// ---------------------------------------------------------------------------

/** Team totals for one side. `null` means the source had no value, not zero. */
export interface TeamStats {
  team: string;
  expectedGoals: number | null;
  possession: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  shotsOffTarget: number | null;
  shotsBlocked: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  passAccuracy: number | null;
  /** Summed from the per-player feed; absent from the team statistics endpoint. */
  duelsWon: number | null;
  duelsTotal: number | null;
}

export interface LineupPlayer {
  id: number;
  name: string;
  number: number | null;
  position: string | null;
  /** "row:col" from the API, kept raw so the client can lay out a pitch. */
  grid: string | null;
}

export interface TeamLineup {
  team: string;
  formation: string | null;
  coach: string | null;
  /** Shirt colours the API supplies, used to tint the pitch view. */
  colors: { player: string | null; goalkeeper: string | null };
  startXI: LineupPlayer[];
  substitutes: LineupPlayer[];
}

export interface PlayerRating {
  id: number;
  name: string;
  team: string;
  photo: string | null;
  position: string | null;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  shotsTotal: number | null;
  shotsOn: number | null;
  passes: number | null;
  /**
   * Count of accurate passes, NOT a percentage — the player feed's `accuracy`
   * field is always <= `total` (a defender with 13 of 13 reports 13). The team
   * endpoint's "Passes %" is a real percentage; these two are not the same
   * measure and must not be labelled the same way.
   */
  passesAccurate: number | null;
  keyPasses: number | null;
  duelsWon: number | null;
  duelsTotal: number | null;
  tackles: number | null;
  yellow: number | null;
  red: number | null;
  substitute: boolean;
}

export interface MatchStats {
  teams: TeamStats[];
  lineups: TeamLineup[];
  players: PlayerRating[];
  /** Which parts the upstream actually had — the UI hides empty sections. */
  available: { stats: boolean; lineups: boolean; players: boolean };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Possession and pass accuracy arrive as "62%".
  const parsed = Number(String(v).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

/** GET one of the fixture sub-resources, tolerating an empty payload. */
async function fetchFixtureResource<T>(path: string, label: string): Promise<T[]> {
  const res = await fetch(apiUrl(path), { headers: apiHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API-Football ${label} request failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: T[]; errors?: unknown };
  const errors = data.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Boolean(errors) && Object.keys(errors as object).length > 0;
  if (hasErrors) throw new Error(`API-Football ${label} returned errors: ${JSON.stringify(errors)}`);
  return data.response ?? [];
}

interface ApiTeamStatistics {
  team?: { name?: string };
  statistics?: { type?: string; value?: unknown }[];
}

function toTeamStats(entry: ApiTeamStatistics, duels: Map<string, { won: number; total: number }>): TeamStats {
  const by = new Map<string, unknown>();
  for (const s of entry.statistics ?? []) if (s.type) by.set(s.type, s.value);
  const team = entry.team?.name ?? 'Unknown';
  const d = duels.get(team);
  return {
    team,
    // API-Football names this one in snake_case while every other key is
    // title-cased, so it is looked up separately rather than by a shared helper.
    expectedGoals: num(by.get('expected_goals')),
    possession: num(by.get('Ball Possession')),
    shotsTotal: num(by.get('Total Shots')),
    shotsOnTarget: num(by.get('Shots on Goal')),
    shotsOffTarget: num(by.get('Shots off Goal')),
    shotsBlocked: num(by.get('Blocked Shots')),
    corners: num(by.get('Corner Kicks')),
    fouls: num(by.get('Fouls')),
    offsides: num(by.get('Offsides')),
    yellowCards: num(by.get('Yellow Cards')),
    redCards: num(by.get('Red Cards')),
    saves: num(by.get('Goalkeeper Saves')),
    passesTotal: num(by.get('Total passes')),
    passesAccurate: num(by.get('Passes accurate')),
    passAccuracy: num(by.get('Passes %')),
    duelsWon: d ? d.won : null,
    duelsTotal: d ? d.total : null,
  };
}

interface ApiLineupSlot {
  player?: { id?: number; name?: string; number?: number; pos?: string; grid?: string };
}

interface ApiLineup {
  team?: { name?: string; colors?: { player?: { primary?: string }; goalkeeper?: { primary?: string } } };
  coach?: { name?: string };
  formation?: string;
  startXI?: ApiLineupSlot[];
  substitutes?: ApiLineupSlot[];
}

const toLineupPlayer = (p: ApiLineupSlot): LineupPlayer => ({
  id: p?.player?.id ?? 0,
  name: p?.player?.name ?? 'Unknown',
  number: p?.player?.number ?? null,
  position: p?.player?.pos ?? null,
  grid: p?.player?.grid ?? null,
});

function toLineup(entry: ApiLineup): TeamLineup {
  return {
    team: entry.team?.name ?? 'Unknown',
    formation: entry.formation ?? null,
    coach: entry.coach?.name ?? null,
    colors: {
      player: entry.team?.colors?.player?.primary ? `#${entry.team.colors.player.primary}` : null,
      goalkeeper: entry.team?.colors?.goalkeeper?.primary
        ? `#${entry.team.colors.goalkeeper.primary}`
        : null,
    },
    startXI: (entry.startXI ?? []).map(toLineupPlayer),
    substitutes: (entry.substitutes ?? []).map(toLineupPlayer),
  };
}

interface ApiPlayersEntry {
  team?: { name?: string };
  players?: {
    player?: { id?: number; name?: string; photo?: string };
    statistics?: Record<string, any>[];
  }[];
}

function toPlayerRatings(entries: ApiPlayersEntry[]): PlayerRating[] {
  const out: PlayerRating[] = [];
  for (const entry of entries) {
    const team = entry.team?.name ?? 'Unknown';
    for (const p of entry.players ?? []) {
      const s = p.statistics?.[0] ?? {};
      out.push({
        id: p.player?.id ?? 0,
        name: p.player?.name ?? 'Unknown',
        team,
        photo: p.player?.photo ?? null,
        position: s.games?.position ?? null,
        minutes: num(s.games?.minutes),
        rating: num(s.games?.rating),
        goals: num(s.goals?.total),
        assists: num(s.goals?.assists),
        shotsTotal: num(s.shots?.total),
        shotsOn: num(s.shots?.on),
        passes: num(s.passes?.total),
        passesAccurate: num(s.passes?.accuracy),
        keyPasses: num(s.passes?.key),
        duelsWon: num(s.duels?.won),
        duelsTotal: num(s.duels?.total),
        tackles: num(s.tackles?.total),
        yellow: num(s.cards?.yellow),
        red: num(s.cards?.red),
        substitute: Boolean(s.games?.substitute),
      });
    }
  }
  return out;
}

/**
 * Everything the detail screen shows beyond the scoreline, in one shot.
 *
 * Three upstream calls against a 100/day quota, which is why this is only ever
 * reached through the cache in `matchStats.ts` and never from the poll loop.
 * A failure in any one part degrades that section to empty rather than failing
 * the request: a missing lineup should not cost the user their xG.
 */
export async function fetchMatchStats(matchId: string): Promise<MatchStats> {
  const id = encodeURIComponent(matchId);

  const [statsRes, lineupRes, playerRes] = await Promise.allSettled([
    fetchFixtureResource<ApiTeamStatistics>(`fixtures/statistics?fixture=${id}`, 'statistics'),
    fetchFixtureResource<ApiLineup>(`fixtures/lineups?fixture=${id}`, 'lineups'),
    fetchFixtureResource<ApiPlayersEntry>(`fixtures/players?fixture=${id}`, 'player stats'),
  ]);

  const settled = <T>(r: PromiseSettledResult<T[]>): T[] => (r.status === 'fulfilled' ? r.value : []);
  const playerEntries = settled(playerRes);
  const players = toPlayerRatings(playerEntries);

  // Team duel totals are not on the statistics endpoint, so roll them up from
  // the per-player feed. Coverage is patchy — when every player is null the
  // total stays null rather than collapsing to a misleading 0.
  const duels = new Map<string, { won: number; total: number }>();
  for (const p of players) {
    if (p.duelsWon === null && p.duelsTotal === null) continue;
    const acc = duels.get(p.team) ?? { won: 0, total: 0 };
    acc.won += p.duelsWon ?? 0;
    acc.total += p.duelsTotal ?? 0;
    duels.set(p.team, acc);
  }

  const teamStats = settled(statsRes);
  const lineups = settled(lineupRes);

  return {
    teams: teamStats.map((t) => toTeamStats(t, duels)),
    lineups: lineups.map(toLineup),
    players,
    available: {
      stats: teamStats.length > 0,
      lineups: lineups.length > 0,
      players: players.length > 0,
    },
  };
}
