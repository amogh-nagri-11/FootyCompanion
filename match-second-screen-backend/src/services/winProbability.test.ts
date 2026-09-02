import { describe, expect, it } from 'vitest';
import { calculateWinProbability, countRedCards } from './winProbability.js';
import { LiveMatchState, MatchEvent } from './sportsApi.js';

function state(over: Partial<LiveMatchState> = {}): LiveMatchState {
  return {
    matchId: 'test',
    homeTeam: 'Home',
    awayTeam: 'Away',
    homeScore: 0,
    awayScore: 0,
    minute: 45,
    status: 'live',
    events: [],
    ...over,
  };
}

function card(team: string, detail: string, minute = 30): MatchEvent {
  return { id: `${team}-${minute}`, matchId: 'test', minute, type: 'card', team, detail };
}

describe('countRedCards', () => {
  it('counts straight reds and second bookings, per side', () => {
    const events = [
      card('Home', 'Red Card'),
      card('Away', 'Second Yellow card', 40),
      card('Away', 'Yellow Card', 50),
      card('Nobody', 'Red Card', 60),
    ];
    expect(countRedCards(events, 'Home', 'Away')).toEqual({ home: 1, away: 1 });
  });

  it('ignores yellows and non-card events', () => {
    const events = [
      card('Home', 'Yellow Card'),
      { id: 'g', matchId: 'test', minute: 10, type: 'goal' as const, team: 'Home', detail: 'Goal' },
    ];
    expect(countRedCards(events, 'Home', 'Away')).toEqual({ home: 0, away: 0 });
  });
});

describe('calculateWinProbability', () => {
  it('returns three percentages that sum to about 100', () => {
    const p = calculateWinProbability(state());
    expect(p.home + p.draw + p.away).toBeGreaterThanOrEqual(99);
    expect(p.home + p.draw + p.away).toBeLessThanOrEqual(101);
  });

  it('favours the side that is ahead', () => {
    const ahead = calculateWinProbability(state({ homeScore: 2, awayScore: 0 }));
    expect(ahead.home).toBeGreaterThan(ahead.away);
  });

  it('collapses to a near-certainty once time is up', () => {
    const done = calculateWinProbability(state({ homeScore: 1, minute: 90 }));
    expect(done.home).toBe(100);
  });

  // The bug this guards: before red cards were modelled, a dismissal moved the
  // bar by exactly zero, which is the moment a reader most expects it to move.
  it('shifts toward the eleven-man side when the other goes down to ten', () => {
    const level = state({ minute: 45 });
    const before = calculateWinProbability(level);
    const after = calculateWinProbability(
      state({ minute: 45, events: [card('Away', 'Red Card')] })
    );

    expect(after.home).toBeGreaterThan(before.home);
    expect(after.away).toBeLessThan(before.away);
  });

  it('treats a second dismissal as worse than the first', () => {
    const one = calculateWinProbability(
      state({ events: [card('Away', 'Red Card', 20)] })
    );
    const two = calculateWinProbability(
      state({ events: [card('Away', 'Red Card', 20), card('Away', 'Red Card', 30)] })
    );
    expect(two.home).toBeGreaterThan(one.home);
  });

  it('cancels out when both sides are reduced equally', () => {
    const both = calculateWinProbability(
      state({ events: [card('Home', 'Red Card', 20), card('Away', 'Red Card', 25)] })
    );
    const neither = calculateWinProbability(state());
    // Not identical — the rates change — but the balance should not swing.
    expect(Math.abs(both.home - neither.home)).toBeLessThanOrEqual(3);
  });

  it('does not move the bar after full time, when nothing can change', () => {
    const ended = state({ minute: 90, homeScore: 1, awayScore: 1 });
    const withRed = state({ minute: 90, homeScore: 1, awayScore: 1, events: [card('Home', 'Red Card')] });
    expect(calculateWinProbability(withRed)).toEqual(calculateWinProbability(ended));
  });
});
