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

async function fetchMockLiveMatch(matchId: string): Promise<LiveMatchState> {
  const minute = Math.floor(Math.random() * 90);
  return {
    matchId,
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    homeScore: minute > 30 ? 1 : 0,
    awayScore: 0,
    minute,
    status: 'live',
    events: minute > 30
      ? [{ id: 'evt-1', matchId, minute: 31, type: 'goal', team: 'Arsenal', detail: 'Header from corner' }]
      : [],
  };
}

async function fetchRealLiveMatch(matchId: string): Promise<LiveMatchState> {
  const res = await fetch(
    `https://${config.apiFootballHost}/v3/fixtures?id=${matchId}`,
    {
      headers: {
        'X-RapidAPI-Key': config.apiFootballKey,
        'X-RapidAPI-Host': config.apiFootballHost,
      },
    }
  );

  if (!res.ok) throw new Error(`API-Football request failed: ${res.status}`);
  const data = await res.json();

  // NOTE: actual response shape needs mapping once you see a real payload —
  // this is a placeholder until we test against a real fixture ID.
  return data as LiveMatchState;
}

export async function fetchLiveMatch(matchId: string): Promise<LiveMatchState> {
  return config.useMockSportsData
    ? fetchMockLiveMatch(matchId)
    : fetchRealLiveMatch(matchId);
}