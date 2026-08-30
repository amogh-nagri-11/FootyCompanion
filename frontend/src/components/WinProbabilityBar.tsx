import type { MatchState, WinProb } from '../types';
import styles from './WinProbabilityBar.module.css';

interface Props {
  winProb: WinProb;
  state: MatchState | null;
}

/** Below this share a segment is too narrow to hold its own label legibly. */
const INLINE_LABEL_MIN_PCT = 12;

export function WinProbabilityBar({ winProb, state }: Props) {
  // The backend rounds each outcome independently, so the three can sum to
  // 99 or 101. Normalise before using them as flex widths.
  const total = winProb.home + winProb.draw + winProb.away || 1;
  const pct = (v: number) => (v / total) * 100;

  const homeName = state?.homeTeam ?? 'Home';
  const awayName = state?.awayTeam ?? 'Away';

  const segments = [
    { key: 'home', value: winProb.home, cls: styles.homeSeg, label: homeName },
    { key: 'draw', value: winProb.draw, cls: styles.drawSeg, label: 'Draw' },
    { key: 'away', value: winProb.away, cls: styles.awaySeg, label: awayName },
  ];

  return (
    <section className={styles.card} aria-label="Win probability">
      <h2 className={styles.heading}>Win probability</h2>

      <div
        className={styles.bar}
        role="img"
        aria-label={`${homeName} ${winProb.home}%, draw ${winProb.draw}%, ${awayName} ${winProb.away}%`}
      >
        {segments.map((s) => (
          <div key={s.key} className={s.cls} style={{ width: `${pct(s.value)}%` }}>
            {pct(s.value) >= INLINE_LABEL_MIN_PCT ? `${s.value}%` : ''}
          </div>
        ))}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.homeSwatch} aria-hidden="true" />
          <span className={styles.legendLabel}>{homeName}</span>
          <span className={styles.legendValue}>{winProb.home}%</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.drawSwatch} aria-hidden="true" />
          <span className={styles.legendLabel}>Draw</span>
          <span className={styles.legendValue}>{winProb.draw}%</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.awaySwatch} aria-hidden="true" />
          <span className={styles.legendLabel}>{awayName}</span>
          <span className={styles.legendValue}>{winProb.away}%</span>
        </span>
      </div>
    </section>
  );
}
