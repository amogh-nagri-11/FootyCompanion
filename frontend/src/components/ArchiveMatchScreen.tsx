import { api } from '../lib/api';
import { href } from '../hooks/useRoute';
import { useApiResource } from '../hooks/useApiResource';
import type { ArchivedMatch } from '../types';
import { EventFeed } from './EventFeed';
import styles from './Screens.module.css';

const NO_HIGHLIGHTS = new Set<string>();

export function ArchiveMatchScreen({ matchId }: { matchId: string }) {
  const { data, loading, error } = useApiResource(
    () => api.get<ArchivedMatch>(`/matches/archive/${encodeURIComponent(matchId)}`),
    [matchId]
  );

  if (loading) return <div className={styles.state}>Loading match…</div>;
  if (error) return <div className={`${styles.state} ${styles.error}`}>{error}</div>;
  if (!data) return null;

  const [home, away] = data.final_score.split('-').map((n) => Number(n) || 0);

  return (
    <>
      <a className={styles.back} href={href('/archive')}>
        ← Back to archive
      </a>

      <h2 className={styles.title}>
        {data.home_team} {home}–{away} {data.away_team}
      </h2>
      <p className={styles.subtitle}>
        {data.summary} Played {new Date(data.played_at).toLocaleString()}.
      </p>

      {/* Reuse the live feed: an archived event log is the same shape, just
          with nothing arriving, so nothing is ever highlighted. */}
      <EventFeed
        events={[...data.event_log].sort((a, b) => b.minute - a.minute)}
        freshEventIds={NO_HIGHLIGHTS}
        state={{
          matchId: data.match_id,
          homeTeam: data.home_team,
          awayTeam: data.away_team,
          homeScore: home,
          awayScore: away,
          minute: 90,
          status: 'finished',
        }}
      />
    </>
  );
}
