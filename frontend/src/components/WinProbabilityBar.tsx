import type { MatchState, WinProb } from '../types';
import styles from './WinProbabilityBar.module.css';

interface Props {
  winProb: WinProb;
  state: MatchState | null;
}

export function WinProbabilityBar({ winProb, state }: Props) {
  // The backend rounds each outcome independently, so the three can sum to
  // 99 or 101. Normalise before using them as widths.
  const total = winProb.home + winProb.draw + winProb.away || 1;
  const pct = (v: number) => (v / total) * 100;

  const homeName = state?.homeTeam ?? 'Home';
  const awayName = state?.awayTeam ?? 'Away';

  const outcomes = [
    { key: 'home', value: winProb.home, seg: styles.homeSeg, swatch: styles.homeSwatch, label: homeName },
    { key: 'draw', value: winProb.draw, seg: styles.drawSeg, swatch: styles.drawSwatch, label: 'Draw' },
    { key: 'away', value: winProb.away, seg: styles.awaySeg, swatch: styles.awaySwatch, label: awayName },
  ];

  const leader = outcomes.reduce((best, o) => (o.value > best.value ? o : best));

  return (
    <section className={styles.card} aria-label="Win probability">
      <div className={styles.header}>
        <h2 className={styles.heading}>Win probability</h2>
        <span className={styles.leader}>
          {leader.key === 'draw' ? 'Level' : leader.label} {leader.value}%
        </span>
      </div>

      <div
        className={styles.bar}
        role="img"
        aria-label={`${homeName} ${winProb.home}%, draw ${winProb.draw}%, ${awayName} ${winProb.away}%`}
      >
        {outcomes.map((o) => (
          <div key={o.key} className={o.seg} style={{ width: `${pct(o.value)}%` }} />
        ))}
      </div>

      <div className={styles.legend}>
        {outcomes.map((o) => (
          <span key={o.key} className={styles.legendItem}>
            <span className={styles.legendTop}>
              <span className={o.swatch} aria-hidden="true" />
              <span className={styles.legendLabel}>{o.label}</span>
            </span>
            <span className={styles.legendValue}>{o.value}%</span>
          </span>
        ))}
      </div>
    </section>
  );
}
