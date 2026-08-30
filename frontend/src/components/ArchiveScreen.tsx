import { api } from '../lib/api';
import { href } from '../hooks/useRoute';
import { useApiResource } from '../hooks/useApiResource';
import type { ArchivedMatchRow } from '../types';
import styles from './Screens.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ArchiveScreen() {
  const { data, loading, error } = useApiResource(
    () => api.get<{ matches: ArchivedMatchRow[] }>('/matches/archive'),
    []
  );

  if (loading) return <div className={styles.state}>Loading archive…</div>;
  if (error) return <div className={`${styles.state} ${styles.error}`}>{error}</div>;

  const matches = data?.matches ?? [];

  return (
    <>
      <h2 className={styles.title}>Archive</h2>
      <p className={styles.subtitle}>
        Every match the server has followed through to full time.
      </p>

      {matches.length === 0 ? (
        <div className={styles.state}>
          Nothing archived yet. Matches are added here automatically when they finish.
        </div>
      ) : (
        <ul className={styles.list}>
          {matches.map((m) => (
            <li key={m.match_id} className={styles.card}>
              <a
                className={styles.archiveLink}
                href={href(`/archive/${encodeURIComponent(m.match_id)}`)}
              >
                <div>
                  <div className={styles.teams}>
                    {m.home_team} v {m.away_team}
                  </div>
                  <div className={styles.summary}>{m.summary ?? 'Full time.'}</div>
                </div>
                <div>
                  <div className={styles.score}>{m.final_score.replace('-', '–')}</div>
                  <div className={styles.date}>{formatDate(m.played_at)}</div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
