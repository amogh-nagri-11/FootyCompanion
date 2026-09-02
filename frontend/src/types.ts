export type MatchEventType = 'goal' | 'card' | 'substitution' | 'other';

export interface MatchEvent {
  id: string;
  matchId: string;
  minute: number;
  type: MatchEventType;
  team: string;
  detail: string;
  playerName?: string | null;
  assistName?: string | null;
}

export type MatchStatus = 'live' | 'finished' | 'not_started';

export interface MatchState {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status: MatchStatus;
}

export interface WinProb {
  /** Percentages, 0-100. */
  home: number;
  away: number;
  draw: number;
}

/** Sent once, immediately after the socket is authenticated. */
export interface ConnectedMessage {
  type: 'connected';
  matchId: string;
  /** Whether this user has an FPL team linked, so the UI can prompt. */
  fplLinked?: boolean;
}

/**
 * Sent whenever the poller sees events it has not broadcast before.
 * `events` is a *delta*, not the full history — the client accumulates.
 */
export interface UpdateMessage {
  type: 'update';
  events: MatchEvent[];
  state: MatchState;
  winProb: WinProb;
}

export type ServerMessage =
  | ConnectedMessage
  | UpdateMessage
  | FplUpdateMessage
  | FplAlertMessage
  | FeedHealthMessage;

export interface MatchSummary {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status: MatchStatus;
  league: string | null;
  country: string | null;
  /** Kickoff time (ISO). Present for upcoming fixtures. */
  kickoff?: string | null;
  /** Feed team ids — the stable identity a follow is matched on. */
  homeTeamId?: number | null;
  awayTeamId?: number | null;
}

/** Why a match feed stopped updating, so a stale score can say it is stale. */
export type FeedStatus = 'ok' | 'degraded' | 'quota' | 'stopped';

export interface FeedHealth {
  status: FeedStatus;
  message: string | null;
  failures: number;
  lastUpdate: string | null;
}

export interface FeedHealthMessage {
  type: 'feed_health';
  matchId: string;
  health: FeedHealth;
}

export interface FollowedTeam {
  team_name: string;
  team_id: number | null;
  created_at: string;
}

/** Which list `/matches/live` returned: what is in play, or the next kickoffs. */
export type FixtureKind = 'live' | 'upcoming';

export interface Profile {
  id: string;
  username: string | null;
  created_at: string;
  email?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  favourite_team?: string | null;
  fpl_team_id?: number | null;
  updated_at?: string | null;
  stats?: { followedTeams: number; savedMatches: number };
  /** True when db/migrations/001_profile_fields.sql has not been applied. */
  migrationPending?: boolean;
  /** Fields the database could not store, echoed back after a save. */
  skipped?: string[];
}

export interface ProfileFieldsPatch {
  username?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  favouriteTeam?: string;
}

export interface ArchivedMatchRow {
  match_id: string;
  home_team: string;
  away_team: string;
  final_score: string;
  summary: string | null;
  played_at: string;
}

export interface ArchivedMatch extends ArchivedMatchRow {
  event_log: MatchEvent[];
}

export interface SquadPlayer {
  fplId: number;
  name: string;
  team: string;
  position: string;
  /** FPL's own points for this player, before the multiplier. */
  points: number;
  multiplier: number;
  effectivePoints: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isBench: boolean;
  minutes: number;
  goals: number;
  assists: number;
}

export interface SquadView {
  entryId: number;
  gameweek: number;
  totalPoints: number;
  benchPoints: number;
  activeChip: string | null;
  players: SquadPlayer[];
}

/** Reconciled squad totals, straight from FPL's live endpoint. */
export interface FplUpdateMessage extends SquadView {
  type: 'fpl_update';
  matchId: string;
}

/** Fired the moment the match feed sees one of your players involved. */
export interface FplAlertMessage {
  type: 'fpl_alert';
  matchId: string;
  gameweek: number;
  role: 'scorer' | 'assist';
  player: { fplId: number; name: string };
  isCaptain: boolean;
  onBench: boolean;
  multiplier: number;
  event: { minute: number; type: MatchEventType; detail: string };
}

export interface FplAlert extends FplAlertMessage {
  /** Client-side id, since the same player can feature more than once. */
  key: string;
}

// --- Match statistics -------------------------------------------------------
// `null` throughout means the upstream had no value for this fixture, which is
// common on the free tier and must render as "—" rather than 0.

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
  duelsWon: number | null;
  duelsTotal: number | null;
}

export interface LineupPlayer {
  id: number;
  name: string;
  number: number | null;
  position: string | null;
  /** "row:col" from the API — row 1 is the keeper. */
  grid: string | null;
}

export interface TeamLineup {
  team: string;
  formation: string | null;
  coach: string | null;
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
  /** Count of accurate passes, not a percentage (see the backend's note). */
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
  available: { stats: boolean; lineups: boolean; players: boolean };
  cached: boolean;
}

/** `/matches/by-date` — one UTC day, plus the range the plan allows. */
export interface DatedFixtureList {
  matches: MatchSummary[];
  cached: boolean;
  date: string;
  window: { from: string; to: string };
}
