import { describe, expect, it } from 'vitest';
import { pollIntervalFor } from './apiQuota.js';
import { config } from '../config.js';

/**
 * The pacing half of the quota fix. `claimRequest` is the enforcing half and
 * needs Redis, so it is exercised by the integration path rather than here;
 * this pins the arithmetic that decides how often a match may be polled.
 */
describe('pollIntervalFor', () => {
  it('never polls faster than the configured floor', () => {
    expect(pollIntervalFor(1)).toBeGreaterThanOrEqual(config.pollIntervalMs);
    expect(pollIntervalFor(50)).toBeGreaterThanOrEqual(config.pollIntervalMs);
  });

  // The actual bug: each watched match used to spend from the shared budget
  // on its own timer, so N matches cost N times as much with no back-pressure.
  it('slows down as more matches are watched', () => {
    // A real free-tier budget: large limits leave every case on the floor,
    // which would make this pass without exercising the division at all.
    const one = pollIntervalFor(1, 100);
    const ten = pollIntervalFor(10, 100);
    expect(ten).toBeGreaterThan(one);
  });

  it('treats zero matches as one, rather than dividing by zero', () => {
    expect(Number.isFinite(pollIntervalFor(0))).toBe(true);
    expect(pollIntervalFor(0)).toBe(pollIntervalFor(1));
  });

  it('keeps a whole day of polling inside the budget it was given', () => {
    const limit = 100;
    const matches = 4;
    const interval = pollIntervalFor(matches, limit);
    // A six-hour window is what the spacing is derived from.
    const requestsPerMatch = (6 * 60 * 60 * 1000) / interval;
    // The poll reserve is 30% of the limit; allow the rounding slack.
    expect(requestsPerMatch * matches).toBeLessThanOrEqual(limit * 0.3 + matches);
  });

  it('gives a bigger budget a faster cadence', () => {
    expect(pollIntervalFor(4, 100_000)).toBeLessThanOrEqual(pollIntervalFor(4, 100));
  });
});
