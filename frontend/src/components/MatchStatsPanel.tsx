import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { MatchStats, PlayerRating, TeamLineup, TeamStats } from '../types';
import { LineupPitch } from './LineupPitch';
import styles from './MatchStatsPanel.module.css';

type Tab = 'stats' | 'lineups' | 'players';

interface Props {
  matchId: string;
  /** Only picks a cache lifetime upstream; a wrong value costs freshness. */
  finished: boolean;
  homeTeam: string;
  awayTeam: string;
}

/** One row of the head-to-head comparison. */
interface StatRow {
  label: string;
  home: number | null;
  away: number | null;
  /** Renders "2.93" rather than "3", for xG. */
  decimals?: number;
  suffix?: string;
}

const fmt = (v: number | null, decimals = 0, suffix = '') =>
  v === null ? '—' : `${v.toFixed(decimals)}${suffix}`;

export function MatchStatsPanel({ matchId, finished, homeTeam, awayTeam }: Props) {
  const [tab, setTab] = useState<Tab>('stats');

  const { data, loading, error, reload } = useApiResource(
    () =>
      api.get<MatchStats>(
        `/matches/${encodeURIComponent(matchId)}/stats?finished=${finished}`
      ),
    [matchId, finished]
  );

  // The API names teams as it likes; match on name so home and away never swap.
  const [home, away] = useMemo(() => {
    const teams = data?.teams ?? [];
    const find = (name: string) => teams.find((t) => t.team === name) ?? null;
    return [find(homeTeam) ?? teams[0] ?? null, find(awayTeam) ?? teams[1] ?? null];
  }, [data, homeTeam, awayTeam]);

  if (loading) return <div className={styles.state}>Loading match stats…</div>;

  if (error) {
    return (
      <div className={`${styles.state} ${styles.error}`}>
        <p>{error}</p>
        <button className={styles.retry} type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { available } = data;
  if (!available.stats && !available.lineups && !available.players) {
    return (
      <div className={styles.state}>
        <p className={styles.stateTitle}>No detailed stats for this match</p>
        <p>
          Statistics, lineups and ratings appear once the teams are announced — and
          smaller competitions are often never covered at all.
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; enabled: boolean }[] = [
    { id: 'stats', label: 'Stats', enabled: available.stats },
    { id: 'lineups', label: 'Lineups', enabled: available.lineups },
    { id: 'players', label: 'Player ratings', enabled: available.players },
  ];
  const active = tabs.find((t) => t.id === tab)?.enabled
    ? tab
    : (tabs.find((t) => t.enabled)?.id ?? 'stats');

  return (
    <section className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="Match detail">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            disabled={!t.enabled}
            className={`${styles.tab} ${active === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {data.cached && <span className={styles.cachedTag}>cached</span>}
      </div>

      {active === 'stats' && <StatsTab home={home} away={away} />}
      {active === 'lineups' && (
        <LineupsTab lineups={data.lineups} homeTeam={homeTeam} awayTeam={awayTeam} />
      )}
      {active === 'players' && (
        <PlayersTab players={data.players} homeTeam={homeTeam} awayTeam={awayTeam} />
      )}
    </section>
  );
}

function StatsTab({ home, away }: { home: TeamStats | null; away: TeamStats | null }) {
  if (!home || !away) return <div className={styles.state}>No team statistics.</div>;

  const rows: StatRow[] = [
    { label: 'Expected goals (xG)', home: home.expectedGoals, away: away.expectedGoals, decimals: 2 },
    { label: 'Possession', home: home.possession, away: away.possession, suffix: '%' },
    { label: 'Shots on target', home: home.shotsOnTarget, away: away.shotsOnTarget },
    { label: 'Total shots', home: home.shotsTotal, away: away.shotsTotal },
    { label: 'Shots off target', home: home.shotsOffTarget, away: away.shotsOffTarget },
    { label: 'Blocked shots', home: home.shotsBlocked, away: away.shotsBlocked },
    { label: 'Duels won', home: home.duelsWon, away: away.duelsWon },
    { label: 'Corners', home: home.corners, away: away.corners },
    { label: 'Passes', home: home.passesTotal, away: away.passesTotal },
    { label: 'Pass accuracy', home: home.passAccuracy, away: away.passAccuracy, suffix: '%' },
    { label: 'Saves', home: home.saves, away: away.saves },
    { label: 'Fouls', home: home.fouls, away: away.fouls },
    { label: 'Offsides', home: home.offsides, away: away.offsides },
    { label: 'Yellow cards', home: home.yellowCards, away: away.yellowCards },
    { label: 'Red cards', home: home.redCards, away: away.redCards },
  ];

  // A row neither side has any value for is noise, not information.
  const visible = rows.filter((r) => r.home !== null || r.away !== null);
  if (visible.length === 0) return <div className={styles.state}>No team statistics.</div>;

  return (
    <div className={styles.stats}>
      {visible.map((row) => {
        const h = row.home ?? 0;
        const a = row.away ?? 0;
        const total = h + a;
        // With no total there is nothing to divide, so show an even split
        // rather than letting 0/0 collapse the bar to one side.
        const homePct = total > 0 ? (h / total) * 100 : 50;

        return (
          <div className={styles.statRow} key={row.label}>
            <div className={styles.statHead}>
              <span className={`${styles.statValue} ${h > a ? styles.statLead : ''}`}>
                {fmt(row.home, row.decimals, row.suffix)}
              </span>
              <span className={styles.statLabel}>{row.label}</span>
              <span className={`${styles.statValue} ${a > h ? styles.statLead : ''}`}>
                {fmt(row.away, row.decimals, row.suffix)}
              </span>
            </div>
            <div
              className={styles.bar}
              role="img"
              aria-label={`${row.label}: home ${fmt(row.home, row.decimals, row.suffix)}, away ${fmt(row.away, row.decimals, row.suffix)}`}
            >
              <span className={styles.barHome} style={{ width: `${homePct}%` }} />
              <span className={styles.barAway} style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineupsTab({
  lineups,
  homeTeam,
  awayTeam,
}: {
  lineups: TeamLineup[];
  homeTeam: string;
  awayTeam: string;
}) {
  if (lineups.length === 0) {
    return <div className={styles.state}>Lineups are not published for this match yet.</div>;
  }

  const ordered = [homeTeam, awayTeam]
    .map((name) => lineups.find((l) => l.team === name))
    .filter((l): l is TeamLineup => Boolean(l));
  const shown = ordered.length === lineups.length ? ordered : lineups;

  return (
    <div className={styles.lineups}>
      {shown.map((lineup) => (
        <LineupPitch key={lineup.team} lineup={lineup} />
      ))}
    </div>
  );
}

function PlayersTab({
  players,
  homeTeam,
  awayTeam,
}: {
  players: PlayerRating[];
  homeTeam: string;
  awayTeam: string;
}) {
  const teams = useMemo(() => {
    const names = [homeTeam, awayTeam].filter((n) => players.some((p) => p.team === n));
    const extra = [...new Set(players.map((p) => p.team))].filter((n) => !names.includes(n));
    return [...names, ...extra];
  }, [players, homeTeam, awayTeam]);

  if (players.length === 0) return <div className={styles.state}>No player ratings.</div>;

  return (
    <div className={styles.players}>
      {teams.map((team) => {
        const squad = players
          .filter((p) => p.team === team)
          // Unrated players (usually unused subs) sink to the bottom rather
          // than sorting as if they had scored zero.
          .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));

        return (
          <div className={styles.playerTeam} key={team}>
            <h4 className={styles.playerTeamName}>{team}</h4>
            <ul className={styles.playerList}>
              {squad.map((p) => (
                <li className={styles.playerRow} key={`${p.team}-${p.id}-${p.name}`}>
                  <RatingChip rating={p.rating} />
                  <div className={styles.playerMain}>
                    <span className={styles.playerName}>
                      {p.name}
                      {p.substitute && <span className={styles.subTag}>sub</span>}
                    </span>
                    <span className={styles.playerMeta}>
                      {[
                        p.position,
                        p.minutes !== null ? `${p.minutes}'` : null,
                        p.goals ? `${p.goals} goal${p.goals > 1 ? 's' : ''}` : null,
                        p.assists ? `${p.assists} assist${p.assists > 1 ? 's' : ''}` : null,
                        p.duelsWon !== null && p.duelsTotal !== null
                          ? `${p.duelsWon}/${p.duelsTotal} duels`
                          : null,
                        p.passes !== null ? `${p.passes} passes` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <div className={styles.playerCards}>
                    {!!p.yellow && <span className={styles.yellowCard} title="Yellow card" />}
                    {!!p.red && <span className={styles.redCard} title="Red card" />}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Colour-coded rating, on the 0–10 scale the source uses. */
function RatingChip({ rating }: { rating: number | null }) {
  if (rating === null) return <span className={`${styles.rating} ${styles.ratingNone}`}>—</span>;

  const tone =
    rating >= 8 ? styles.ratingHigh : rating >= 7 ? styles.ratingGood : rating >= 6 ? styles.ratingOk : styles.ratingPoor;

  return <span className={`${styles.rating} ${tone}`}>{rating.toFixed(1)}</span>;
}
