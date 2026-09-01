import { useMemo } from 'react';
import type { LineupPlayer, TeamLineup } from '../types';
import styles from './LineupPitch.module.css';

/**
 * The starting XI drawn on a pitch.
 *
 * API-Football gives each starter a `grid` of "row:col", where row 1 is the
 * keeper and the column counts across that row. That is enough to place every
 * player without hard-coding a table of formations: rows become bands up the
 * pitch, and each player is spaced evenly across its own row.
 *
 * When the grid is missing — it is optional upstream, and absent for some
 * competitions — the pitch is skipped in favour of a plain list, which is
 * honest about what is known rather than inventing positions.
 */
export function LineupPitch({ lineup }: { lineup: TeamLineup }) {
  const rows = useMemo(() => groupByRow(lineup.startXI), [lineup.startXI]);
  const shirt = lineup.colors.player ?? 'var(--accent, #16a34a)';
  const keeperShirt = lineup.colors.goalkeeper ?? shirt;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h4 className={styles.team}>{lineup.team}</h4>
        <span className={styles.meta}>
          {lineup.formation ?? 'Formation unknown'}
          {lineup.coach && ` · ${lineup.coach}`}
        </span>
      </header>

      {rows ? (
        <div className={styles.pitch}>
          <span className={styles.halfway} aria-hidden="true" />
          <span className={styles.centreCircle} aria-hidden="true" />
          <span className={styles.box} aria-hidden="true" />

          {rows.map((row, rowIndex) => (
            <div className={styles.row} key={rowIndex}>
              {row.map((player) => (
                <Shirt
                  key={player.id || `${player.name}-${player.number}`}
                  player={player}
                  colour={rowIndex === 0 ? keeperShirt : shirt}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <ul className={styles.plainList}>
          {lineup.startXI.map((p) => (
            <li key={p.id || p.name}>
              <span className={styles.plainNumber}>{p.number ?? '–'}</span>
              {p.name}
              {p.position && <span className={styles.plainPos}>{p.position}</span>}
            </li>
          ))}
        </ul>
      )}

      {lineup.substitutes.length > 0 && (
        <div className={styles.subs}>
          <h5 className={styles.subsTitle}>Substitutes</h5>
          <ul className={styles.subsList}>
            {lineup.substitutes.map((p) => (
              <li key={p.id || p.name} className={styles.sub}>
                <span className={styles.subNumber}>{p.number ?? '–'}</span>
                <span className={styles.subName}>{p.name}</span>
                {p.position && <span className={styles.subPos}>{p.position}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Shirt({ player, colour }: { player: LineupPlayer; colour: string }) {
  return (
    <div className={styles.player} title={`${player.number ?? ''} ${player.name}`.trim()}>
      <span
        className={styles.shirt}
        style={{ background: colour, color: readableOn(colour) }}
      >
        {player.number ?? ''}
      </span>
      <span className={styles.name}>{surname(player.name)}</span>
    </div>
  );
}

/**
 * Ink that stays readable on a club's own shirt colour.
 *
 * Kits run the full range — Brighton play in white, Juventus in near-black —
 * so a fixed white number disappears on half the teams in the database. This
 * picks by perceived brightness (the sRGB luma weights, which track how light
 * a colour looks rather than its raw channel sum) and falls back to white for
 * anything it cannot parse, such as a CSS variable.
 */
function readableOn(colour: string): string {
  const hex = colour.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#fff';

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luma > 0.6 ? '#111' : '#fff';
}

/**
 * "E. Martinez" -> "Martinez". Shirts sit a few characters wide, so the last
 * name is what fits and what a viewer scans for.
 */
function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

/**
 * Buckets starters into rows by the grid's row number, ordered by column.
 * Returns null when any starter lacks a grid, since a partial pitch would put
 * players in places they did not play.
 */
function groupByRow(startXI: LineupPlayer[]): LineupPlayer[][] | null {
  if (startXI.length === 0) return null;

  const byRow = new Map<number, { col: number; player: LineupPlayer }[]>();

  for (const player of startXI) {
    if (!player.grid) return null;
    const [rowRaw, colRaw] = player.grid.split(':');
    const row = Number(rowRaw);
    const col = Number(colRaw);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;

    const bucket = byRow.get(row) ?? [];
    bucket.push({ col, player });
    byRow.set(row, bucket);
  }

  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, players]) => players.sort((a, b) => a.col - b.col).map((p) => p.player));
}
