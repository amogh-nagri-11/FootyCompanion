import { beforeEach, describe, expect, it } from 'vitest';
import { clearFeedHealth, getFeedHealth, recordFailure, recordSuccess } from './feedHealth.js';

/**
 * A stale scoreboard used to look identical to a quiet match. These pin the
 * classification a reader is shown, and — just as importantly — that a healthy
 * feed stays silent instead of announcing itself on every poll.
 */
describe('feedHealth', () => {
  beforeEach(() => clearFeedHealth('m1'));

  it('reports ok for a feed nothing has happened to', () => {
    expect(getFeedHealth('m1').status).toBe('ok');
    expect(getFeedHealth('m1').message).toBeNull();
  });

  it('says nothing when a healthy feed polls successfully', () => {
    expect(recordSuccess('m1')).toBeNull();
  });

  it('announces a recovery, so a raised banner comes down', () => {
    recordFailure('m1', new Error('socket hang up'), 1, false);
    const recovered = recordSuccess('m1');
    expect(recovered?.status).toBe('ok');
    expect(recovered?.message).toBeNull();
  });

  it('marks a transient error as degraded and warns the score may lag', () => {
    const health = recordFailure('m1', new Error('socket hang up'), 1, false);
    expect(health.status).toBe('degraded');
    expect(health.message).toMatch(/behind/i);
  });

  it('names an exhausted budget as its own state', () => {
    const health = recordFailure('m1', new Error('Daily quota exhausted'), 1, false);
    expect(health.status).toBe('quota');
    expect(health.message).toMatch(/tomorrow/i);
  });

  it('reports a rejected key without leaking which credential failed', () => {
    const health = recordFailure(
      'm1',
      new Error('API-Football rejected the key (403) for host v3.football.api-sports.io'),
      2,
      false
    );
    expect(health.message).not.toMatch(/api-sports|403|key \(/i);
    expect(health.message).toMatch(/unavailable/i);
  });

  it('marks a given-up feed as stopped and tells the reader to reload', () => {
    const health = recordFailure('m1', new Error('socket hang up'), 5, true);
    expect(health.status).toBe('stopped');
    expect(health.message).toMatch(/reload/i);
  });

  it('remembers the last good update across a later failure', () => {
    recordSuccess('m1');
    const at = getFeedHealth('m1').lastUpdate;
    expect(at).not.toBeNull();

    const health = recordFailure('m1', new Error('boom'), 1, false);
    expect(health.lastUpdate).toBe(at);
  });

  it('carries the failure count through', () => {
    expect(recordFailure('m1', new Error('boom'), 3, false).failures).toBe(3);
  });
});
