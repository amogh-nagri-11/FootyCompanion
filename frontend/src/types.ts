export type MatchEventType = 'goal' | 'card' | 'substitution' | 'other';

export interface MatchEvent {
  id: string;
  matchId: string;
  minute: number;
  type: MatchEventType;
  team: string;
  detail: string;
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

export type ServerMessage = ConnectedMessage | UpdateMessage;
