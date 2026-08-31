import { MatchEvent } from './sportsApi.js';
import { WinProbSample } from './winProbSeries.js';

/**
 * The moment a match turned, computed from the win-probability time series.
 *
 * This is deliberately a deterministic calculation rather than something the
 * LLM is asked to find. Asking a language model to identify the turning point
 * invites a plausible-sounding but unfounded answer; the probability series
 * already knows, and the model's job is only to narrate what the numbers show.
 */

/**
 * Widest gap, in match minutes, over which a swing still counts as one moment.
 * A window of 1 is a single step; larger catches a swing that lands across two
 * or three minutes (a goal, then a red card in the aftermath) which a
 * step-by-step scan would split into two smaller, less meaningful moves.
 */
const MAX_WINDOW_MINUTES = 5;

/** Ignore noise — below this the "turning point" is not a real turn. */
const MIN_SWING_POINTS = 8;

/** Events within this many minutes of the swing are treated as its cause. */
const EVENT_PROXIMITY_MINUTES = 2;

export interface TurningPoint {
  /** Minute the swing completed. */
  minute: number;
  /** Minute the swing started (equal to `minute` for a single-step swing). */
  fromMinute: number;
  /** Signed change in home win probability, in percentage points. */
  delta: number;
  /** Which side the swing favoured. */
  favoured: 'home' | 'away';
  before: WinProbSample;
  after: WinProbSample;
  /** Events around the swing — the likely cause. */
  events: MatchEvent[];
}

/**
 * Finds the largest swing in home win probability across the series.
 *
 * Considers every pair of samples no more than MAX_WINDOW_MINUTES apart, which
 * subsumes the single-step case (adjacent samples) while also catching swings
 * that take two or three minutes to complete.
 *
 * Returns null when the series is too short or nothing moved enough to count —
 * a 0-0 with no incident genuinely has no turning point, and inventing one
 * would be worse than admitting it.
 */
export function findTurningPoint(
  series: WinProbSample[],
  events: MatchEvent[] = []
): TurningPoint | null {
  if (series.length < 2) return null;

  let best: { from: WinProbSample; to: WinProbSample; delta: number } | null = null;

  for (let i = 0; i < series.length - 1; i++) {
    for (let j = i + 1; j < series.length; j++) {
      if (series[j].minute - series[i].minute > MAX_WINDOW_MINUTES) break;

      const delta = series[j].home - series[i].home;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) {
        best = { from: series[i], to: series[j], delta };
      }
    }
  }

  if (!best || Math.abs(best.delta) < MIN_SWING_POINTS) return null;

  const nearby = events
    .filter(
      (event) =>
        event.minute >= best!.from.minute - EVENT_PROXIMITY_MINUTES &&
        event.minute <= best!.to.minute + EVENT_PROXIMITY_MINUTES
    )
    .sort((a, b) => a.minute - b.minute);

  return {
    minute: best.to.minute,
    fromMinute: best.from.minute,
    delta: Number(best.delta.toFixed(1)),
    favoured: best.delta > 0 ? 'home' : 'away',
    before: best.from,
    after: best.to,
    events: nearby,
  };
}
