import { useMatchSocket } from '../hooks/useMatchSocket';
import { href } from '../hooks/useRoute';
import { EventFeed } from './EventFeed';
import { MatchStatsPanel } from './MatchStatsPanel';
import { isTeamFollowed, type FollowRef } from '../lib/teamMatch';
import { Scoreboard } from './Scoreboard';
import { WinProbabilityBar } from './WinProbabilityBar';
import { FplPanel } from './FplPanel';
import { TeamCrest } from './TeamCrest';
import { ChevronLeftIcon, HeartIcon, StarIcon } from './icons';
import styles from './MatchView.module.css';

interface Props {
  matchId: string;
  isSaved: boolean;
  followedTeams: FollowRef[];
  onToggleSave: (matchId: string) => void;
  onToggleFollow: (teamName: string) => void;
}

function Placeholder({
  title,
  text,
  spinner,
}: {
  title: string;
  text: string;
  spinner?: boolean;
}) {
  return (
    <div className={styles.placeholder}>
      {spinner && <span className={styles.bigSpinner} aria-hidden="true" />}
      <p className={styles.placeholderTitle}>{title}</p>
      <p className={styles.placeholderText}>{text}</p>
      <a className={styles.back} href={href('/')}>
        <ChevronLeftIcon size={15} />
        All matches
      </a>
    </div>
  );
}

export function MatchView({
  matchId,
  isSaved,
  followedTeams,
  onToggleSave,
  onToggleFollow,
}: Props) {
  const {
    status,
    error,
    state,
    winProb,
    events,
    freshEventIds,
    squad,
    fplLinked,
    fplAlerts,
    feedHealth,
  } =
    useMatchSocket(matchId);

  // Before any state arrives there is no score to show, so the whole view is a
  // single status panel rather than an empty scoreboard.
  if (!state) {
    if (status === 'error') {
      return <Placeholder title="Could not load the match" text={error ?? 'The live feed is unavailable.'} />;
    }

    if (status === 'connecting') {
      return (
        <Placeholder
          spinner
          title="Connecting…"
          text={`Opening the live feed for match ${matchId}.`}
        />
      );
    }

    return (
      <Placeholder
        spinner
        title="Waiting for match data…"
        text={`Connected to match ${matchId}. The score will appear as soon as the first events come through.`}
      />
    );
  }

  return (
    <>
      <div className={styles.actions}>
        <a className={styles.back} href={href('/')}>
          <ChevronLeftIcon size={15} />
          All matches
        </a>
        <div className={styles.actionButtons}>
          {[state.homeTeam, state.awayTeam].map((team) => {
            const on = isTeamFollowed(team, followedTeams);
            return (
              <button
                key={team}
                type="button"
                className={on ? styles.actionOn : styles.action}
                onClick={() => onToggleFollow(team)}
                aria-pressed={on}
                title={on ? `Unfollow ${team}` : `Follow ${team}`}
              >
                <TeamCrest team={team} size={16} />
                <span className={styles.actionLabel}>{team}</span>
                <HeartIcon size={14} />
              </button>
            );
          })}
          <button
            type="button"
            className={isSaved ? styles.actionOn : styles.action}
            onClick={() => onToggleSave(matchId)}
            aria-pressed={isSaved}
          >
            <StarIcon size={14} filled={isSaved} />
            <span className={styles.actionLabel}>{isSaved ? 'Saved' : 'Save'}</span>
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

      {feedHealth && (
        <div
          className={`${styles.feedBanner} ${
            feedHealth.status === 'stopped' ? styles.feedBannerStopped : ''
          }`}
          role="status"
        >
          <span className={styles.feedBannerDot} aria-hidden="true" />
          <span>{feedHealth.message}</span>
          {feedHealth.lastUpdate && (
            <span className={styles.feedBannerAge}>
              Last update {new Date(feedHealth.lastUpdate).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      <MatchStatsPanel
        matchId={state.matchId}
        finished={state.status === 'finished'}
        homeTeam={state.homeTeam}
        awayTeam={state.awayTeam}
      />
    </>
  );
}
