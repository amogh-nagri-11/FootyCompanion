import { href } from '../hooks/useRoute';
import type { FplAlert, SquadView } from '../types';
import styles from './FplPanel.module.css';

interface Props {
  squad: SquadView | null;
  alerts: FplAlert[];
  fplLinked: boolean;
}

const CHIP_LABELS: Record<string, string> = {
  bboost: 'Bench boost',
  '3xc': 'Triple captain',
  freehit: 'Free hit',
  wildcard: 'Wildcard',
};

function alertLine(alert: FplAlert): string {
  const what =
    alert.role === 'assist'
      ? 'assisted'
      : alert.event.type === 'goal'
        ? 'scored'
        : alert.event.type === 'card'
          ? 'was booked'
          : 'was involved';
  return `${what}${alert.isCaptain ? ' — your captain!' : alert.onBench ? ' (on your bench)' : ''}`;
}

export function FplPanel({ squad, alerts, fplLinked }: Props) {
  if (!fplLinked && !squad) {
    return (
      <section className={styles.card} aria-label="Fantasy points">
        <div className={styles.header}>
          <h2 className={styles.heading}>Your FPL squad</h2>
        </div>
        <p className={styles.empty}>
          Link your Fantasy Premier League team on the{' '}
          <a className={styles.link} href={href('/profile')}>
            Profile
          </a>{' '}
          page to see your points update live during Premier League matches.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="Fantasy points">
      <div className={styles.header}>
        <h2 className={styles.heading}>Your FPL squad</h2>
        {squad && <span className={styles.gw}>Gameweek {squad.gameweek}</span>}
      </div>

      {alerts.length > 0 && (
        <ul className={styles.alerts} aria-live="polite">
          {alerts.map((alert) => (
            <li key={alert.key} className={styles.alert}>
              <span className={styles.alertMinute}>{alert.event.minute}&apos;</span>
              <span className={styles.alertText}>
                <span className={styles.alertName}>{alert.player.name}</span> {alertLine(alert)}
              </span>
              <span className={styles.pending}>confirming…</span>
            </li>
          ))}
        </ul>
      )}

      {squad ? (
        <>
          <div className={styles.totalRow}>
            <span className={styles.total}>{squad.totalPoints}</span>
            <span className={styles.totalLabel}>
              points{squad.benchPoints > 0 ? ` · ${squad.benchPoints} on bench` : ''}
            </span>
            {squad.activeChip && (
              <span className={styles.chip}>
                {CHIP_LABELS[squad.activeChip] ?? squad.activeChip}
              </span>
            )}
          </div>

          <ul className={styles.list}>
            {squad.players.map((player) => (
              <li
                key={player.fplId}
                className={player.isBench ? styles.benched : styles.player}
              >
                <span className={styles.pos}>{player.position}</span>
                <span className={styles.name}>
                  {player.name}
                  {player.isCaptain && <span className={styles.badge}>C</span>}
                  {player.isViceCaptain && <span className={styles.badge}>V</span>}
                  <span className={styles.club}>{player.team}</span>
                </span>
                <span
                  className={`${styles.pts} ${player.effectivePoints > 0 ? styles.scored : ''}`}
                >
                  {player.effectivePoints}
                  {player.multiplier > 1 ? ` (${player.points}×${player.multiplier})` : ''}
                </span>
              </li>
            ))}
          </ul>

          <p className={styles.footer}>Points come from FPL&apos;s own live feed.</p>
        </>
      ) : (
        <p className={styles.empty}>
          Waiting for your squad — points appear once the gameweek is under way.
        </p>
      )}
    </section>
  );
}
