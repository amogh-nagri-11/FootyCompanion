import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import styles from './MatchChat.module.css';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Who was the best player, and why?',
  'How did the substitutions change the game?',
  'Which side deserved to win on the numbers?',
];

const MAX_CHARS = 500;

/**
 * Ask-the-match panel for an archived fixture.
 *
 * The thread lives in component state and is sent whole on each turn — the
 * backend keeps nothing. That makes the feature free to abandon: closing the
 * page ends the conversation, and there is no history to store or purge.
 */
export function MatchChat({
  matchId,
  homeTeam,
  awayTeam,
}: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, but not on first paint — the page
  // should open at the top of the match, not scrolled into an empty panel.
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, pending]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setError(null);
    setPending(true);

    try {
      const { answer } = await api.post<{ answer: string }>(
        `/matches/archive/${encodeURIComponent(matchId)}/chat`,
        { messages: next }
      );
      setTurns([...next, { role: 'assistant', content: answer }]);
    } catch (err) {
      // Keep the question on screen and offer a retry rather than dropping it:
      // losing what you typed to a transient 502 is the worst version of this.
      if (err instanceof ApiError && err.status === 503) setUnavailable(true);
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setTurns(turns);
      setDraft(text);
    } finally {
      setPending(false);
    }
  }

  if (unavailable) {
    return (
      <section className={styles.panel}>
        <Header />
        <p className={styles.notice}>
          Match chat needs an LLM provider configured on the server.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <Header />

      {turns.length === 0 ? (
        <div className={styles.intro}>
          <p className={styles.introText}>
            Ask about {homeTeam} v {awayTeam} — player performances, substitutions, or
            what the numbers say. Answers come from this match&apos;s own event log,
            statistics, lineups and ratings.
          </p>
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.suggestion}
                onClick={() => ask(s)}
                disabled={pending}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className={styles.thread}>
          {turns.map((turn, i) => (
            <li
              key={i}
              className={turn.role === 'user' ? styles.userTurn : styles.assistantTurn}
            >
              {turn.role === 'assistant' && <span className={styles.who}>Answer</span>}
              <p className={styles.bubble}>{turn.content}</p>
            </li>
          ))}
          {pending && (
            <li className={styles.assistantTurn}>
              <span className={styles.who}>Answer</span>
              <p className={`${styles.bubble} ${styles.thinking}`}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </p>
            </li>
          )}
          <div ref={endRef} />
        </ol>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <textarea
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            // Enter sends, shift+enter breaks the line — the convention for a
            // box this size, where multi-line questions are the exception.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          placeholder="Ask about this match…"
          rows={1}
          maxLength={MAX_CHARS}
          disabled={pending}
          aria-label="Ask about this match"
        />
        <button className={styles.send} type="submit" disabled={pending || !draft.trim()}>
          {pending ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </section>
  );
}

function Header() {
  return (
    <header className={styles.head}>
      <h3 className={styles.title}>Ask about this match</h3>
      <span className={styles.tag}>AI</span>
    </header>
  );
}
