import { useEffect, useRef, useState } from 'react';
import type { MatchState } from '../types';
import { TeamCrest } from './TeamCrest';
import styles from './Scoreboard.module.css';

interface Props {
  state: MatchState;
  /** True once the feed has reported the match as finished. */
  ended: boolean;
}

function statusLabel(state: MatchState, ended: boolean): string {
  if (ended || state.status === 'finished') return 'Full time';
  if (state.status === 'not_started') return 'Kick-off pending';
  return `${state.minute}'`;
}

/**
 * Flags the score for a moment each time it changes, so a goal that arrives
 * while you are looking elsewhere still announces itself.
 */
function useScoreFlash(home: number, away: number) {
  const previous = useRef({ home, away });
  const [flash, setFlash] = useState<'home' | 'away' | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { home, away };
    if (before.home === home && before.away === away) return;

    setFlash(home !== before.home ? 'home' : 'away');
    const timer = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(timer);
  }, [home, away]);

  return flash;
}

export function Scoreboard({ state, ended }: Props) {
  const isLive = state.status === 'live' && !ended;
  const flash = useScoreFlash(state.homeScore, state.awayScore);

  return (
    <section className={`${styles.card} ${isLive ? styles.cardLive : ''}`} aria-label="Scoreboard">
      <div className={styles.statusRow}>
        <span className={isLive ? styles.liveChip : styles.chip}>
          {isLive && <span className={styles.dot} aria-hidden="true" />}
          {isLive ? 'Live' : statusLabel(state, ended)}
        </span>
        {isLive && <span className={styles.clock}>{state.minute}&apos;</span>}
      </div>

      <div className={styles.board}>
        <div className={`${styles.team} ${styles.home}`}>
          <TeamCrest team={state.homeTeam} size={52} />
          <div className={styles.teamName}>{state.homeTeam}</div>
          <span className={styles.homeLabel}>Home</span>
        </div>

        <div className={styles.score}>
          <span className={flash === 'home' ? styles.scoreFlash : undefined}>
            {state.homeScore}
          </span>
          <span className={styles.separator}>:</span>
          <span className={flash === 'away' ? styles.scoreFlash : undefined}>
            {state.awayScore}
          </span>
        </div>

        <div className={`${styles.team} ${styles.away}`}>
          <TeamCrest team={state.awayTeam} size={52} />
          <div className={styles.teamName}>{state.awayTeam}</div>
          <span className={styles.awayLabel}>Away</span>
        </div>
      </div>
    </section>
  );
}
