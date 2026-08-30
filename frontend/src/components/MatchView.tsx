import { useMatchSocket } from '../hooks/useMatchSocket';
import { EventFeed } from './EventFeed';
import { Scoreboard } from './Scoreboard';
import { WinProbabilityBar } from './WinProbabilityBar';
import styles from './MatchView.module.css';

interface Props {
  matchId: string;
}

export function MatchView({ matchId }: Props) {
  const { status, error, state, winProb, events, freshEventIds } = useMatchSocket(matchId);

  // Before any state arrives there is no score to show, so the whole view is a
  // single status panel rather than an empty scoreboard.
  if (!state) {
    if (status === 'error') {
      return (
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Could not load the match</p>
          <p className={styles.placeholderText}>{error}</p>
        </div>
      );
    }

    if (status === 'connecting') {
      return (
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>Connecting…</p>
          <p className={styles.placeholderText}>Opening the live feed for match {matchId}.</p>
        </div>
      );
    }

    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Waiting for match data…</p>
        <p className={styles.placeholderText}>
          Connected to match {matchId}. The score will appear as soon as the first events
          come through.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {status === 'connecting' && (
        <div className={`${styles.banner} ${styles.bannerSlot}`} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Reconnecting to the live feed…</span>
        </div>
      )}
      {status === 'ended' && (
        <div className={`${styles.bannerEnded} ${styles.bannerSlot}`} role="status">
          <span aria-hidden="true">🏁</span>
          <span>Match ended — this is the final score.</span>
        </div>
      )}
      {status === 'error' && (
        <div className={`${styles.bannerError} ${styles.bannerSlot}`} role="alert">
          <span>{error} Showing the last data received.</span>
        </div>
      )}

      <div className={styles.boardSlot}>
        <Scoreboard state={state} ended={status === 'ended'} />
      </div>

      {winProb && (
        <div className={styles.probSlot}>
          <WinProbabilityBar winProb={winProb} state={state} />
        </div>
      )}

      <div className={styles.feedSlot}>
        <EventFeed events={events} freshEventIds={freshEventIds} state={state} />
      </div>
    </div>
  );
}
