import styles from './Skeleton.module.css';

/** Placeholder shaped like the grouped match list, shown while it loads. */
export function MatchListSkeleton({ groups = 2, rows = 3 }: { groups?: number; rows?: number }) {
  return (
    <div className={styles.groups} aria-hidden="true">
      {Array.from({ length: groups }, (_, g) => (
        <section key={g}>
          <div className={styles.groupHeader} />
          <div className={styles.rows}>
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className={styles.row}>
                <div className={styles.stack}>
                  <div className={styles.teamLine} style={{ width: `${58 + ((g + r) % 3) * 12}%` }} />
                  <div className={styles.teamLine} style={{ width: `${44 + ((g + r) % 4) * 10}%` }} />
                </div>
                <div className={styles.score} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
