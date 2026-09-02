import { useState, type FormEvent } from 'react';
import { MatchList } from './MatchList';
import { TeamCrest } from './TeamCrest';
import type { FollowRef } from '../lib/teamMatch';
import styles from './Screens.module.css';

interface Props {
  /** Display names, in the order the list is rendered. */
  teams: Set<string>;
  /** The same follows with their ids, for matching fixtures. */
  follows: FollowRef[];
  savedIds: Set<string>;
  onToggleSave: (matchId: string) => void;
  onToggleFollow: (teamName: string) => void;
}

export function FollowingScreen({
  teams,
  follows,
  savedIds,
  onToggleSave,
  onToggleFollow,
}: Props) {
  const [draft, setDraft] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || teams.has(name)) return;
    onToggleFollow(name);
    setDraft('');
  }

  return (
    <>
      <h2 className={styles.title}>Following</h2>
      <p className={styles.subtitle}>
        Team names must match the feed exactly — e.g. “Arsenal”, “České Budějovice”.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a team to follow"
          aria-label="Team name"
        />
        <button className={styles.primary} type="submit" disabled={!draft.trim()}>
          Follow
        </button>
      </form>

      {teams.size === 0 ? (
        <div className={styles.state}>
          You are not following any teams yet. Add one above, or use the follow button on a
          match.
        </div>
      ) : (
        <>
          <div className={styles.card} style={{ marginBottom: 20 }}>
            {[...teams].sort().map((team) => (
              <div key={team} className={styles.row}>
                <span className={styles.teamName}>
                  <TeamCrest team={team} size={24} />
                  {team}
                </span>
                <button
                  className={styles.ghost}
                  type="button"
                  onClick={() => onToggleFollow(team)}
                >
                  Unfollow
                </button>
              </div>
            ))}
          </div>

          <MatchList
            key="following"
            title="Live now"
            upcomingTitle="Next up"
            emptyMessage="None of the teams you follow are playing right now."
            onlyFollows={follows}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
          />
        </>
      )}
    </>
  );
}
