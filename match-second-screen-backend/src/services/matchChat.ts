import { ChatMessage, generateChat, activeProvider } from './llm.js';
import { getMatchStats } from './matchStats.js';
import { MatchEvent } from './sportsApi.js';
import { TurningPoint } from './turningPoint.js';

/**
 * Question-answering over one finished match.
 *
 * The whole design is grounding: the model is given the match's own event log,
 * team statistics, lineups and player ratings, and told to answer from those
 * alone. Football is exactly the subject where a model will happily invent a
 * plausible-sounding tactical read, so the prompt draws a hard line between
 * what is in the data (who played, how long, what they did, how they were
 * rated) and what is not (formations in open play, instructions, intent).
 */

const MAX_TURNS = 20;
const MAX_QUESTION_CHARS = 500;
const MAX_ANSWER_TOKENS = 700;

export interface ArchivedMatchContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  finalScore: string;
  playedAt: string;
  summary: string | null;
  events: MatchEvent[];
  turningPoint: TurningPoint | null;
}

const SYSTEM_PROMPT = `You answer questions about one finished football match, for a fan reading it back afterwards.

Everything you know about this match is in the DATA block below. Ground every claim in it.

What the data supports:
- What happened and when, from the event log.
- Team totals: xG, possession, shots, duels, passes, cards.
- Who started, who came on, shirt numbers, the formation as listed, and the coach.
- Each player's minutes, rating, goals, assists, shots, passes, duels and cards.

What the data does NOT contain — never assert these:
- How the shape changed in open play, pressing schemes, marking, instructions.
- Why a manager did anything. You can describe a substitution and what the data
  shows before and after it; you cannot state the reasoning behind it.
- Anything about injuries, morale, the crowd, refereeing quality, or events
  outside this single match (form, history, what happened next).

How to answer:
- Lead with the answer. Cite the numbers that support it.
- On manager decisions: say what was done (who came off, who came on, at what
  minute) and what the data shows around it. If asked why, make clear the data
  shows the decision and its effect, not the intent, then give the best reading
  the numbers allow, flagged as inference.
- If the data cannot answer the question, say so plainly in one sentence and
  say what it does show that is closest. Never fill a gap with plausible
  football-speak.
- Ratings are the data provider's own numbers, not yours — attribute them.
- Minutes come from the event log only. If a substitution's minute is not in
  the log, say when it is unknown rather than estimating one from playing time.
- Substitution direction in this feed is not always reliable. Before stating
  that a player came on or off, check it against their minutes played: a
  substitute with few minutes came on late, and a starter whose minutes end
  early came off then. If the event log and the minutes disagree, say the
  record is inconsistent and give both readings. Do not pick one silently.
- When the same player appears in more than one event, keep those events
  separate. Never merge two events into one claim.
- Quote the log as plain prose. Never invent citation brackets, footnote
  markers, or a source label that was not given to you.
- The Result line states who won. Never write anything that contradicts it —
  a late goal by the losing side narrows a scoreline, it does not win a match.
- Two to six sentences unless asked for more. Plain prose, no headings. Do not
  open with a pleasantry.`;

function describeEvents(events: MatchEvent[]): string {
  if (events.length === 0) return '(no events recorded)';
  return events
    .slice()
    .sort((a, b) => a.minute - b.minute)
    .map((e) => {
      // Substitutions get their two names spelled out by role. The rendered
      // sentence ("X on for Y") reads fine to a human but invites a model to
      // attach the wrong name to the wrong direction, especially when the same
      // player appears in two substitutions.
      if (e.type === 'substitution' && (e.playerName || e.assistName)) {
        return (
          `${e.minute}' ${e.team} substitution — feed lists ON: ${e.playerName ?? 'unknown'}, ` +
          `OFF: ${e.assistName ?? 'unknown'}`
        );
      }
      return `${e.minute}' ${e.team}: ${e.detail}`;
    })
    .join('\n');
}

/** "—" rather than a bare blank, so the model can see a value is absent. */
const val = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);

/**
 * Builds the DATA block.
 *
 * Stats come from the same cache the stats panel uses, so opening a chat on a
 * match already viewed costs no upstream requests. When they are unavailable
 * the block says so explicitly — an absent section must read as "not known"
 * rather than leaving the model to guess why it is missing.
 */
/** Splits "4-3" into its two goal counts; null when the stored value is odd. */
function parseScore(finalScore: string): [number | null, number | null] {
  const parts = String(finalScore).split(/[-–:]/).map((n) => Number(n.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return [null, null];
  return [parts[0], parts[1]];
}

function describeResult(
  match: ArchivedMatchContext,
  home: number | null,
  away: number | null
): string {
  if (home === null || away === null) return `recorded as ${match.finalScore}`;
  if (home === away) return `${match.homeTeam} and ${match.awayTeam} drew ${home}–${away}`;
  return home > away
    ? `${match.homeTeam} WON ${home}–${away}; ${match.awayTeam} lost`
    : `${match.awayTeam} WON ${away}–${home}; ${match.homeTeam} lost`;
}

async function buildContext(match: ArchivedMatchContext): Promise<string> {
  const [homeGoals, awayGoals] = parseScore(match.finalScore);
  const lines: string[] = [
    'DATA',
    '====',
    // Spelled out rather than left as "4-3" between two names. In a long
    // context that bare string was being read the wrong way round — one answer
    // had the winning side losing — so the result is stated in words too.
    `Final score: ${match.homeTeam} ${homeGoals ?? '?'}, ${match.awayTeam} ${awayGoals ?? '?'}`,
    `Result: ${describeResult(match, homeGoals, awayGoals)}`,
    `${match.homeTeam} played at home; ${match.awayTeam} played away.`,
    `Played: ${match.playedAt}`,
    '',
    'Event log:',
    describeEvents(match.events),
    '',
  ];

  if (match.turningPoint) {
    const tp = match.turningPoint;
    const favoured = tp.favoured === 'home' ? match.homeTeam : match.awayTeam;
    lines.push(
      'Turning point (computed from the win-probability series, not guessed):',
      `- Minutes ${tp.fromMinute}–${tp.minute}, ${match.homeTeam} win probability ` +
        `${tp.before.home}% -> ${tp.after.home}% (${tp.delta > 0 ? '+' : ''}${tp.delta} points, favouring ${favoured})`,
      `- Events then: ${
        tp.events.length > 0 ? tp.events.map((e) => `${e.minute}' ${e.team} ${e.detail}`).join('; ') : 'none recorded'
      }`,
      ''
    );
  } else {
    lines.push('Turning point: none — win probability never swung sharply.', '');
  }

  let stats;
  try {
    stats = await getMatchStats(match.matchId, true);
  } catch {
    // A stats outage should still leave a usable chat over the event log.
    stats = null;
  }

  if (stats?.available.stats && stats.teams.length > 0) {
    lines.push('Team statistics:');
    for (const t of stats.teams) {
      lines.push(
        `- ${t.team}: xG ${val(t.expectedGoals)}, possession ${val(t.possession, '%')}, ` +
          `shots ${val(t.shotsTotal)} (${val(t.shotsOnTarget)} on target, ${val(t.shotsBlocked)} blocked), ` +
          `duels won ${val(t.duelsWon)}/${val(t.duelsTotal)}, passes ${val(t.passesTotal)} at ${val(t.passAccuracy, '%')}, ` +
          `corners ${val(t.corners)}, fouls ${val(t.fouls)}, saves ${val(t.saves)}, ` +
          `cards ${val(t.yellowCards)}Y ${val(t.redCards)}R`
      );
    }
    lines.push('');
  } else {
    lines.push('Team statistics: not available for this match.', '');
  }

  if (stats?.available.lineups && stats.lineups.length > 0) {
    lines.push('Lineups:');
    for (const l of stats.lineups) {
      lines.push(
        `- ${l.team} (${l.formation ?? 'formation unknown'}, coach ${l.coach ?? 'unknown'})`,
        `  Started: ${l.startXI.map((p) => `${p.number ?? '?'} ${p.name}${p.position ? ` [${p.position}]` : ''}`).join(', ')}`,
        `  Bench: ${l.substitutes.map((p) => `${p.number ?? '?'} ${p.name}`).join(', ') || 'none listed'}`
      );
    }
    lines.push('');
  } else {
    lines.push('Lineups: not available for this match.', '');
  }

  if (stats?.available.players && stats.players.length > 0) {
    lines.push('Player statistics (rating is the data provider\'s own 0–10 figure):');
    for (const p of stats.players) {
      const bits = [
        p.position,
        p.minutes !== null ? `${p.minutes} min` : null,
        p.substitute ? 'came off the bench' : 'started',
        p.rating !== null ? `rated ${p.rating}` : 'unrated',
        p.goals ? `${p.goals} goals` : null,
        p.assists ? `${p.assists} assists` : null,
        p.shotsTotal !== null ? `${p.shotsTotal} shots (${val(p.shotsOn)} on target)` : null,
        p.passes !== null
          ? `${p.passes} passes (${val(p.passesAccurate)} accurate)`
          : null,
        p.keyPasses ? `${p.keyPasses} key passes` : null,
        p.duelsWon !== null ? `${p.duelsWon}/${val(p.duelsTotal)} duels won` : null,
        p.tackles !== null ? `${p.tackles} tackles` : null,
        p.yellow ? `${p.yellow} yellow` : null,
        p.red ? `${p.red} red` : null,
      ].filter(Boolean);
      lines.push(`- ${p.name} (${p.team}): ${bits.join(', ')}`);
    }
    lines.push('');
  } else {
    lines.push('Player statistics: not available for this match.', '');
  }

  return lines.join('\n');
}

export class ChatUnavailableError extends Error {
  constructor() {
    super('Match chat needs an LLM provider. Set LLM_PROVIDER and its API key.');
    this.name = 'ChatUnavailableError';
  }
}

export class ChatRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatRequestError';
  }
}

/** Rejects a malformed or oversized conversation before it costs a call. */
export function validateTurns(turns: unknown): ChatMessage[] {
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new ChatRequestError('Send at least one message.');
  }
  if (turns.length > MAX_TURNS) {
    throw new ChatRequestError(`This conversation is too long — start a new one.`);
  }

  const clean: ChatMessage[] = turns.map((t) => {
    const role = (t as ChatMessage)?.role;
    const content = (t as ChatMessage)?.content;
    if (role !== 'user' && role !== 'assistant') {
      throw new ChatRequestError('Each message needs a role of "user" or "assistant".');
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ChatRequestError('Messages cannot be empty.');
    }
    if (role === 'user' && content.length > MAX_QUESTION_CHARS) {
      throw new ChatRequestError(`Questions are limited to ${MAX_QUESTION_CHARS} characters.`);
    }
    return { role, content: content.trim() };
  });

  if (clean[clean.length - 1].role !== 'user') {
    throw new ChatRequestError('The last message must be a question.');
  }
  return clean;
}

/**
 * Answers the latest question in `turns` about `match`.
 *
 * The data block is prepended to the first user turn rather than kept in the
 * system prompt so the whole conversation stays anchored to it as the thread
 * grows, and so the provider caches it the same way on every follow-up.
 */
export async function answerMatchQuestion(
  match: ArchivedMatchContext,
  turns: ChatMessage[]
): Promise<string> {
  if (activeProvider() === 'none') throw new ChatUnavailableError();

  const context = await buildContext(match);
  const [first, ...rest] = turns;
  const grounded: ChatMessage[] = [
    { role: 'user', content: `${context}\n\nQUESTION\n========\n${first.content}` },
    ...rest,
  ];

  const answer = await generateChat(SYSTEM_PROMPT, grounded, MAX_ANSWER_TOKENS);
  if (!answer) {
    throw new Error('The model did not return an answer. Try again in a moment.');
  }
  return answer;
}
