import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { href } from '../hooks/useRoute';
import { useApiResource } from '../hooks/useApiResource';
import type { MatchSummary } from '../types';
import { majorLeagueRank, TIER_LABELS, type Tier } from '../lib/leagues';
import styles from './MatchList.module.css';

interface Props {
  /** Restrict to these match ids (saved view) or teams (following view). */
  onlyMatchIds?: Set<string>;
  onlyTeams?: Set<string>;
  title: string;
  emptyMessage: string;
  savedIds: Set<string>;
  onToggleSave: (matchId: string) => void;
  /** Used to float leagues containing a followed team to the top. */
  followedTeams?: Set<string>;
}

export function MatchList({
  onlyMatchIds,
  onlyTeams,
  title,
  emptyMessage,
  savedIds,
  onToggleSave,
  followedTeams,
}: Props) {
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useApiResource(
    () => api.get<{ matches: MatchSummary[]; cached: boolean }>('/matches/live'),
    []
  );

  const filtered = useMemo(() => {
    let list = data?.matches ?? [];
    if (onlyMatchIds) list = list.filter((m) => onlyMatchIds.has(m.matchId));
    if (onlyTeams) {
      list = list.filter((m) => onlyTeams.has(m.homeTeam) || onlyTeams.has(m.awayTeam));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        [m.homeTeam, m.awayTeam, m.league, m.country]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data, onlyMatchIds, onlyTeams, query]);

  const groups = useMemo(() => {
    const byLeague = new Map<
      string,
      { league: string; country: string | null; matches: MatchSummary[] }
    >();

    for (const match of filtered) {
      const league = match.league ?? 'Other';
      // League names repeat across countries ("Premier League" exists in
      // England, Armenia, Belarus …), so the country is part of the identity.
      const key = `${league}|${match.country ?? ''}`;
      const group = byLeague.get(key);
      if (group) group.matches.push(match);
      else byLeague.set(key, { league, country: match.country, matches: [match] });
    }

    return [...byLeague.values()]
      .map((group) => {
        // Sort by team name, not minute: minutes tick on every refresh and
        // would make rows jump around under the reader's cursor.
        group.matches.sort((a, b) => a.homeTeam.localeCompare(b.homeTeam));

        const rank = majorLeagueRank(group.league, group.country);
        const hasFollowed =
          !!followedTeams?.size &&
          group.matches.some(
            (m) => followedTeams.has(m.homeTeam) || followedTeams.has(m.awayTeam)
          );

        const tier: Tier = hasFollowed ? 0 : rank >= 0 ? 1 : 2;
        return { ...group, tier, rank };
      })
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          // Majors keep their curated order; everything else is alphabetical.
          (a.tier === 1 ? a.rank - b.rank : 0) ||
          a.league.localeCompare(b.league) ||
          (a.country ?? '').localeCompare(b.country ?? '')
      );
  }, [filtered, followedTeams]);

  if (loading) return <div className={styles.state}>Loading matches…</div>;

  if (error) {
    return (
      <div className={`${styles.state} ${styles.error}`}>
        {error}
        <button className={styles.retry} type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.subtitle}>
            {filtered.length} {filtered.length === 1 ? 'match' : 'matches'} in{' '}
            {groups.length} {groups.length === 1 ? 'league' : 'leagues'}
            {data?.cached ? ' · cached' : ''}
          </p>
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="Filter by team or league"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter matches"
        />
      </div>

      {filtered.length === 0 ? (
        <div className={styles.state}>{query ? 'No matches match that filter.' : emptyMessage}</div>
      ) : (
        <div className={styles.groups}>
          {groups.map((group, i) => (
            <section key={`${group.league}|${group.country ?? ''}`}>
              {(i === 0 || groups[i - 1].tier !== group.tier) &&
                groups.some((g) => g.tier !== groups[0].tier) && (
                  <p className={styles.tierLabel}>{TIER_LABELS[group.tier]}</p>
                )}
              <h3 className={styles.groupHeader}>
                <span className={styles.groupName}>{group.league}</span>
                {group.country && <span className={styles.groupCountry}>{group.country}</span>}
                <span className={styles.groupCount}>{group.matches.length}</span>
              </h3>
              <ul className={styles.list}>
                {group.matches.map((m) => (
                  <MatchRow
                    key={m.matchId}
                    match={m}
                    isSaved={savedIds.has(m.matchId)}
                    onToggleSave={onToggleSave}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function MatchRow({
  match,
  isSaved,
  onToggleSave,
}: {
  match: MatchSummary;
  isSaved: boolean;
  onToggleSave: (matchId: string) => void;
}) {
  const label = `${match.homeTeam} v ${match.awayTeam}`;

  return (
    <li className={styles.row}>
      <a className={styles.link} href={href(`/match/${encodeURIComponent(match.matchId)}`)}>
        <div>
          <div className={styles.teams}>{label}</div>
          <div className={styles.meta}>
            <span className={match.status === 'live' ? styles.minute : styles.finished}>
              {match.status === 'live'
                ? `${match.minute}'`
                : match.status === 'finished'
                  ? 'FT'
                  : '—'}
            </span>
          </div>
        </div>
        <div className={styles.score}>
          {match.homeScore}–{match.awayScore}
        </div>
      </a>
      <button
        type="button"
        className={`${styles.saveBtn} ${isSaved ? styles.saved : ''}`}
        onClick={() => onToggleSave(match.matchId)}
        aria-pressed={isSaved}
        aria-label={isSaved ? `Unsave ${label}` : `Save ${label}`}
        title={isSaved ? 'Saved' : 'Save match'}
      >
        {isSaved ? '★' : '☆'}
      </button>
    </li>
  );
}
