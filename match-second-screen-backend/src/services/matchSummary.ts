import { generateText, activeProvider } from './llm.js';
import { LiveMatchState, MatchEvent } from './sportsApi.js';
import { TurningPoint } from './turningPoint.js';

const SYSTEM_PROMPT = `You write short post-match football reports for a live-scores app.

You will be given a match result, its full event log, and — when one exists — the
single moment the match turned, already identified from win-probability data.

Rules:
- Build the report around the given turning point. That moment is the story; the
  rest of the match is context for it.
- Do not identify a different turning point, and do not hedge about which moment
  mattered. The swing has been calculated, not guessed.
- Refer to the minute and what happened. You may mention the probability swing
  in plain language ("all but ended the contest"), but do not invent statistics.
- Mention only events that appear in the event log. No lineups, no attendance,
  no tactical claims you cannot support from the events given.
- 2 to 4 sentences. Past tense. No heading, no bullet points, no preamble.`;

/** Deterministic fallback — also the summary used when no provider is set. */
export function templatedSummary(
  state: LiveMatchState,
  turningPoint: TurningPoint | null
): string {
  const { homeTeam, awayTeam, homeScore, awayScore } = state;

  const result =
    homeScore === awayScore
      ? `${homeTeam} drew ${homeScore}–${awayScore} with ${awayTeam}.`
      : homeScore > awayScore
        ? `${homeTeam} beat ${awayTeam} ${homeScore}–${awayScore}.`
        : `${awayTeam} beat ${homeTeam} ${awayScore}–${homeScore}.`;

  if (!turningPoint) return result;

  const favoured = turningPoint.favoured === 'home' ? homeTeam : awayTeam;
  const cause = turningPoint.events[0]?.detail;
  const swing = Math.abs(turningPoint.delta);

  return cause
    ? `${result} The match turned in the ${turningPoint.minute}th minute — ${cause} — swinging it ${swing} points toward ${favoured}.`
    : `${result} The match turned in the ${turningPoint.minute}th minute, swinging ${swing} points toward ${favoured}.`;
}

function describeEvents(events: MatchEvent[]): string {
  if (events.length === 0) return '(no events recorded)';
  return events
    .slice()
    .sort((a, b) => a.minute - b.minute)
    .map((e) => `${e.minute}' ${e.team}: ${e.detail}`)
    .join('\n');
}

function buildPrompt(
  state: LiveMatchState,
  events: MatchEvent[],
  turningPoint: TurningPoint | null
): string {
  const lines = [
    `Result: ${state.homeTeam} ${state.homeScore}–${state.awayScore} ${state.awayTeam} (full time)`,
    '',
    'Event log:',
    describeEvents(events),
    '',
  ];

  if (turningPoint) {
    const favoured = turningPoint.favoured === 'home' ? state.homeTeam : state.awayTeam;
    lines.push(
      'Turning point (already computed from win probability — build the report around this):',
      `- Minute ${turningPoint.fromMinute} to ${turningPoint.minute}`,
      `- ${state.homeTeam} win probability moved from ${turningPoint.before.home}% to ${turningPoint.after.home}%` +
        ` (${turningPoint.delta > 0 ? '+' : ''}${turningPoint.delta} points, favouring ${favoured})`,
      `- Events at that moment: ${
        turningPoint.events.length > 0
          ? turningPoint.events.map((e) => `${e.minute}' ${e.team} ${e.detail}`).join('; ')
          : 'none recorded'
      }`
    );
  } else {
    lines.push(
      'Turning point: none — win probability never moved sharply. Say so plainly;',
      'write a short report of an even game rather than manufacturing a decisive moment.'
    );
  }

  return lines.join('\n');
}

/**
 * Narrative summary of a finished match, centred on its computed turning point.
 *
 * Falls back to the templated sentence when no provider is configured or the
 * call fails, so archiving never depends on an external service being up.
 */
export async function generateMatchSummary(
  state: LiveMatchState,
  events: MatchEvent[],
  turningPoint: TurningPoint | null
): Promise<{ summary: string; generated: boolean }> {
  const fallback = templatedSummary(state, turningPoint);

  if (activeProvider() === 'none') return { summary: fallback, generated: false };

  const text = await generateText(SYSTEM_PROMPT, buildPrompt(state, events, turningPoint), 400);
  return text ? { summary: text, generated: true } : { summary: fallback, generated: false };
}
