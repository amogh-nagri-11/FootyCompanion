import { describe, expect, it } from 'vitest';
import { isTeamFollowed, matchesAnyFollow, matchesFollow, normaliseTeam } from './teamMatch';
import type { MatchSummary } from '../types';

const fixture = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  matchId: '1',
  homeTeam: 'Manchester City',
  awayTeam: 'Arsenal',
  homeScore: 0,
  awayScore: 0,
  minute: 0,
  status: 'not_started',
  league: 'Premier League',
  country: 'England',
  kickoff: null,
  homeTeamId: 50,
  awayTeamId: 42,
  ...over,
});

describe('normaliseTeam', () => {
  it('drops club-type words and punctuation', () => {
    expect(normaliseTeam('Manchester City F.C.')).toBe('manchester city');
  });

  it('strips accents', () => {
    expect(normaliseTeam('Atlético Madrid')).toBe('atletico madrid');
  });
});

describe('matchesFollow', () => {
  // The reported bug: a follow typed as "Man City" never matched the feed.
  it('matches by id when the stored name differs from the feed', () => {
    expect(matchesFollow(fixture(), { teamName: 'Man City', teamId: 50 })).toBe(true);
  });

  it('matches by normalised name when there is no id', () => {
    expect(matchesFollow(fixture(), { teamName: 'Arsenal FC', teamId: null })).toBe(true);
  });

  it('does not match an unrelated team', () => {
    expect(matchesFollow(fixture(), { teamName: 'Everton', teamId: 11 })).toBe(false);
  });

  it('falls back to the name when a stale id misses', () => {
    expect(matchesFollow(fixture(), { teamName: 'Arsenal', teamId: 999 })).toBe(true);
  });

  it('tolerates a fixture with no ids at all', () => {
    const noIds = fixture({ homeTeamId: null, awayTeamId: null });
    expect(matchesFollow(noIds, { teamName: 'Manchester City', teamId: 50 })).toBe(true);
  });
});

describe('matchesAnyFollow', () => {
  it('is false for an empty follow list', () => {
    expect(matchesAnyFollow(fixture(), [])).toBe(false);
  });

  it('is true when any follow plays', () => {
    const follows = [
      { teamName: 'Everton', teamId: 11 },
      { teamName: 'Arsenal', teamId: 42 },
    ];
    expect(matchesAnyFollow(fixture(), follows)).toBe(true);
  });
});

describe('isTeamFollowed', () => {
  it('recognises a differently spelled follow, so it is not offered twice', () => {
    expect(isTeamFollowed('Arsenal', [{ teamName: 'Arsenal FC', teamId: 42 }])).toBe(true);
  });

  it('is false for a team that is not followed', () => {
    expect(isTeamFollowed('Chelsea', [{ teamName: 'Arsenal', teamId: 42 }])).toBe(false);
  });
});
