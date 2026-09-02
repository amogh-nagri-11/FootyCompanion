import { describe, expect, it } from 'vitest';
import { fixtureMatchesFollow, normaliseTeam } from './teamDirectory.js';

/**
 * Deterministic string matching, not a model — see the note in the module.
 * These are the cases that were silently broken when follows compared the
 * typed name to the feed with `===`.
 */

describe('normaliseTeam', () => {
  it('strips club-type words', () => {
    expect(normaliseTeam('Manchester City FC')).toBe('manchester city');
    expect(normaliseTeam('AFC Bournemouth')).toBe('bournemouth');
  });

  // Regression: full stops used to split "F.C." into "f c", which the
  // club-type rule could no longer see, leaving it in the normalised name.
  it('handles dotted abbreviations', () => {
    expect(normaliseTeam('Manchester City F.C.')).toBe('manchester city');
  });

  it('strips accents and punctuation', () => {
    expect(normaliseTeam('České Budějovice')).toBe('ceske budejovice');
    expect(normaliseTeam('Saint-Étienne')).toBe('saint etienne');
  });

  it('collapses case and whitespace', () => {
    expect(normaliseTeam('  ARSENAL  ')).toBe('arsenal');
  });

  it('makes trivially different spellings compare equal', () => {
    expect(normaliseTeam('Real Madrid CF')).toBe(normaliseTeam('real madrid'));
  });
});

describe('fixtureMatchesFollow', () => {
  const fixture = {
    homeTeam: 'Manchester City',
    awayTeam: 'Arsenal',
    homeTeamId: 50,
    awayTeamId: 42,
  };

  it('matches on team id regardless of the stored name', () => {
    expect(fixtureMatchesFollow(fixture, { teamId: 50, teamName: 'Man City' })).toBe(true);
  });

  it('matches the away side too', () => {
    expect(fixtureMatchesFollow(fixture, { teamId: 42, teamName: 'Arsenal' })).toBe(true);
  });

  it('does not match an unrelated id and name', () => {
    expect(fixtureMatchesFollow(fixture, { teamId: 99, teamName: 'Everton' })).toBe(false);
  });

  // The rows that existed before ids were stored.
  it('falls back to a normalised name when there is no id', () => {
    expect(fixtureMatchesFollow(fixture, { teamId: null, teamName: 'manchester city fc' })).toBe(
      true
    );
  });

  it('still matches by name when the id is stale and misses', () => {
    // An id from an earlier season that no longer appears on this fixture must
    // not veto a name that plainly does match.
    expect(fixtureMatchesFollow(fixture, { teamId: 777, teamName: 'Arsenal' })).toBe(true);
  });

  it('is unmoved by a name that only partly overlaps', () => {
    expect(fixtureMatchesFollow(fixture, { teamId: null, teamName: 'Manchester' })).toBe(false);
  });
});
