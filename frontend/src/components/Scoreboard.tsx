import type { MatchState } from '../types';
import styles from './Scoreboard.module.css';

interface Props {
  state: MatchState;
  /** True once the feed has reported the match as finished. */
  ended: boolean;
}

function statusLabel(state: MatchState, ended: boolean): string {
  if (ended || state.status === 'finished') return 'Full time';
  if (state.status === 'not_started') return 'Not started';
  return `${state.minute}'`;
}

export function Scoreboard({ state, ended }: Props) {
  const isLive = state.status === 'live' && !ended;

  return (
    <section className={styles.card} aria-label="Scoreboard">
      <div className={`${styles.statusRow} ${isLive ? styles.live : ''}`}>
        <span className={isLive ? styles.dot : styles.dotIdle} aria-hidden="true" />
        <span>{isLive ? 'Live' : statusLabel(state, ended)}</span>
        {isLive && <span>· {state.minute}&apos;</span>}
      </div>

      <div className={styles.board}>
        <div className={`${styles.team} ${styles.home}`}>
          <div className={styles.teamName}>{state.homeTeam}</div>
          <span className={styles.homeLabel}>Home</span>
        </div>

        <div className={styles.score}>
          <span>{state.homeScore}</span>
          <span className={styles.separator}>–</span>
          <span>{state.awayScore}</span>
        </div>

        <div className={`${styles.team} ${styles.away}`}>
          <div className={styles.teamName}>{state.awayTeam}</div>
          <span className={styles.awayLabel}>Away</span>
        </div>
      </div>
    </section>
  );
}
