import { useMatchSocket } from '../hooks/useMatchSocket';
import { href } from '../hooks/useRoute';
import { EventFeed } from './EventFeed';
import { Scoreboard } from './Scoreboard';
import { WinProbabilityBar } from './WinProbabilityBar';
import { FplPanel } from './FplPanel';
import styles from './MatchView.module.css';

interface Props {
  matchId: string;
  isSaved: boolean;
  followedTeams: Set<string>;
  onToggleSave: (matchId: string) => void;
  onToggleFollow: (teamName: string) => void;
}

export function MatchView({
  matchId,
  isSaved,
  followedTeams,
  onToggleSave,
  onToggleFollow,
}: Props) {
  const { status, error, state, winProb, events, freshEventIds, squad, fplLinked, fplAlerts } =
    useMatchSocket(matchId);

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
    <>
      <div className={styles.actions}>
        <a className={styles.back} href={href('/')}>
          ← All matches
        </a>
        <div className={styles.actionButtons}>
          {[state.homeTeam, state.awayTeam].map((team) => (
            <button
              key={team}
              type="button"
              className={followedTeams.has(team) ? styles.actionOn : styles.action}
              onClick={() => onToggleFollow(team)}
              aria-pressed={followedTeams.has(team)}
            >
              {followedTeams.has(team) ? '✓ Following' : 'Follow'} {team}
            </button>
          ))}
          <button
            type="button"
            className={isSaved ? styles.actionOn : styles.action}
            onClick={() => onToggleSave(matchId)}
            aria-pressed={isSaved}
          >
            {isSaved ? '★ Saved' : '☆ Save match'}
          </button>
        </div>
      </div>

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

      {/* Both side panels share one grid area so they stack directly under one
          another; as separate areas the tall feed spanning two rows pushed the
          FPL panel down to the feed's midpoint. */}
      <div className={styles.sideSlot}>
        {winProb && <WinProbabilityBar winProb={winProb} state={state} />}
        <FplPanel squad={squad} alerts={fplAlerts} fplLinked={fplLinked} />
      </div>

      <div className={styles.feedSlot}>
        <EventFeed events={events} freshEventIds={freshEventIds} state={state} />
      </div>
      </div>
    </>
  );
}
