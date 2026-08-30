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