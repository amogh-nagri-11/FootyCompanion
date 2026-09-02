import { useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { href } from '../hooks/useRoute';
import { useApiResource } from '../hooks/useApiResource';
import type { DatedFixtureList, FixtureKind, MatchSummary } from '../types';
import { majorLeagueRank, TIER_LABELS, type Tier } from '../lib/leagues';
import { matchesAnyFollow, type FollowRef } from '../lib/teamMatch';
import { TeamCrest } from './TeamCrest';
import { MatchListSkeleton } from './Skeleton';
import { DateBar, todayUtc } from './DateBar';
import { SearchIcon, StarIcon } from './icons';
import styles from './MatchList.module.css';

/** `/matches/live` — what is in play, or the next kickoffs when nothing is. */
interface LiveFixtureList {
  matches: MatchSummary[];
  cached: boolean;
  kind?: FixtureKind;
}

type FixtureResponse = LiveFixtureList | DatedFixtureList;

interface Props {
  /** Restrict to these match ids (saved view) or followed teams (following view). */
  onlyMatchIds?: Set<string>;
  onlyFollows?: FollowRef[];
  title: string;
  /** Heading to use when nothing is in play and the list is showing kickoffs. */
  upcomingTitle?: string;
  emptyMessage: string;
  savedIds: Set<string>;
  onToggleSave: (matchId: string) => void;
  /** Used to float leagues containing a followed team to the top. */
  followedTeams?: FollowRef[];
  /**
   * Show the day picker and load fixtures by date. The home screen browses;
   * the saved and following screens stay pinned to what is in play.
   */
  browseByDate?: boolean;
}

export function MatchList({
  onlyMatchIds,
  onlyFollows,
  title,
  upcomingTitle,
  emptyMessage,
  savedIds,
  onToggleSave,
  followedTeams,
  browseByDate = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(todayUtc());

  const { data, loading, error, reload } = useApiResource<FixtureResponse>(
    () =>
      browseByDate
        ? api.get<DatedFixtureList>(`/matches/by-date?date=${date}`)
        : api.get<LiveFixtureList>('/matches/live'),
    [browseByDate, date]
  );

  // Remembered across loads so the strip keeps its shape while the next day
  // fetches, instead of collapsing to one button and jumping under the cursor.
  const windowRef = useRef<DatedFixtureList['window'] | null>(null);
  if (data && 'window' in data) windowRef.current = data.window;
  const window = windowRef.current;

  const today = todayUtc();
  // A past day has no kickoffs left to show and a future one is all kickoffs,
  // so the date view labels itself by the day rather than by the live fallback.
  const kind: FixtureKind = browseByDate
    ? date > today
      ? 'upcoming'
      : 'live'
    : data && 'kind' in data
      ? (data.kind ?? 'live')
      : 'live';
  const upcoming = kind === 'upcoming';

  const filtered = useMemo(() => {
    let list = data?.matches ?? [];
    if (onlyMatchIds) list = list.filter((m) => onlyMatchIds.has(m.matchId));
    // Matched on team id where available, so a follow saved as "Man City"
    // still catches a fixture the feed calls "Manchester City".
    if (onlyFollows) list = list.filter((m) => matchesAnyFollow(m, onlyFollows));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        [m.homeTeam, m.awayTeam, m.league, m.country]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data, onlyMatchIds, onlyFollows, query]);

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
        // Kickoffs read best in the order they will happen. Live rows sort by
        // team name instead of minute: minutes tick on every refresh and would
        // make rows jump around under the reader's cursor.
        group.matches.sort((a, b) =>
          upcoming && a.kickoff && b.kickoff
            ? Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
              a.homeTeam.localeCompare(b.homeTeam)
            : a.homeTeam.localeCompare(b.homeTeam)
        );

        const rank = majorLeagueRank(group.league, group.country);
        const hasFollowed =
          !!followedTeams?.length &&
          group.matches.some((m) => matchesAnyFollow(m, followedTeams));

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
  }, [filtered, followedTeams, upcoming]);

  const liveCount = useMemo(
    () => filtered.filter((m) => m.status === 'live').length,
    [filtered]
  );

  const dateBar = browseByDate ? (
    <DateBar date={date} onChange={setDate} window={window} />
  ) : null;

  if (loading) {
    return (
      <>
        <PageHeader title={title} subtitle="Fetching fixtures…" />
        {dateBar}
        <MatchListSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        {dateBar}
        <div className={`${styles.state} ${styles.error}`}>
          <p className={styles.stateText}>{error}</p>
          <button className={styles.retry} type="button" onClick={reload}>
            Try again
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={upcoming ? (upcomingTitle ?? title) : title}
        subtitle={
          <>
            {liveCount > 0 && (
              <span className={styles.livePill}>
                <span className={styles.livePillDot} aria-hidden="true" />
                {liveCount} live
              </span>
            )}
            {!browseByDate && upcoming && (
              <span className={styles.soonPill}>Nothing in play</span>
            )}
            <span>
              {filtered.length} {filtered.length === 1 ? 'match' : 'matches'} across{' '}
              {groups.length} {groups.length === 1 ? 'league' : 'leagues'}
              {data?.cached ? ' · cached' : ''}
            </span>
          </>
        }
        search={
          <div className={styles.searchWrap}>
            <SearchIcon size={16} className={styles.searchIcon} />
            <input
              className={styles.search}
              type="search"
              placeholder="Search team or league"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter matches"
            />
          </div>
        }
      />

      {dateBar}

      {!browseByDate && upcoming && filtered.length > 0 && (
        <p className={styles.fallbackNote}>
          No matches are being played right now — here are the next kickoffs.
        </p>
      )}

      {filtered.length === 0 ? (
        <div className={styles.state}>
          <p className={styles.stateTitle}>
            {query
              ? 'Nothing matches that search'
              : browseByDate
                ? 'No fixtures on this day'
                : 'Nothing on right now'}
          </p>
          <p className={styles.stateText}>
            {query ? `No team or league matches “${query.trim()}”.` : emptyMessage}
          </p>
          {query && (
            <button className={styles.retry} type="button" onClick={() => setQuery('')}>
              Clear search
            </button>
          )}
        </div>
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
                    showKickoff={upcoming}
                    isFollowed={!!followedTeams && matchesAnyFollow(m, followedTeams)}
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

function PageHeader({
  title,
  subtitle,
  search,
}: {
  title: string;
  subtitle: React.ReactNode;
  search?: React.ReactNode;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.headerText}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      {search}
    </div>
  );
}

/** "15:30" today, "Sat 15:30" this week, "1 Sep 15:30" beyond it. */
function formatKickoff(iso: string): { time: string; day: string | null } {
  const at = new Date(iso);
  // 'numeric' hour, so a 24h locale gets "18:30" and a 12h one "6:30 PM"
  // rather than the padded "06:30 PM".
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear();
  if (sameDay) return { time, day: null };

  const withinAWeek = at.getTime() - today.getTime() < 6 * 24 * 60 * 60 * 1000;
  return {
    time,
    day: at.toLocaleDateString(
      undefined,
      withinAWeek ? { weekday: 'short' } : { day: 'numeric', month: 'short' }
    ),
  };
}

function MatchRow({
  match,
  isSaved,
  isFollowed,
  showKickoff,
  onToggleSave,
}: {
  match: MatchSummary;
  isSaved: boolean;
  isFollowed: boolean;
  showKickoff: boolean;
  onToggleSave: (matchId: string) => void;
}) {
  const label = `${match.homeTeam} v ${match.awayTeam}`;
  const isLive = match.status === 'live';
  const finished = match.status === 'finished';
  // Before kickoff there is no score to show — 0–0 would read as a result.
  const kickoff =
    showKickoff && match.status === 'not_started' && match.kickoff
      ? formatKickoff(match.kickoff)
      : null;
  // Dim the loser's name once a result stands, the way a printed table would.
  const homeLead = finished && match.homeScore > match.awayScore;
  const awayLead = finished && match.awayScore > match.homeScore;
  const drawn = finished && match.homeScore === match.awayScore;

  return (
    <li
      className={`${styles.row} ${isLive ? styles.rowLive : ''} ${
        kickoff ? styles.rowUpcoming : ''
      }`}
    >
      <a className={styles.link} href={href(`/match/${encodeURIComponent(match.matchId)}`)}>
        <div className={styles.statusRail}>
          {isLive ? (
            <>
              <span className={styles.minute}>{match.minute}&apos;</span>
              <span className={styles.liveTag}>
                <span className={styles.liveDot} aria-hidden="true" />
                Live
              </span>
            </>
          ) : kickoff ? (
            <>
              {kickoff.day && <span className={styles.kickoffDay}>{kickoff.day}</span>}
              <span className={styles.kickoffTime}>{kickoff.time}</span>
            </>
          ) : (
            <span className={finished ? styles.ft : styles.pending}>
              {finished ? 'FT' : '—'}
            </span>
          )}
        </div>

        <div className={styles.teams}>
          <div className={styles.teamLine}>
            <TeamCrest team={match.homeTeam} size={22} />
            <span className={`${styles.teamName} ${homeLead || drawn ? styles.won : ''}`}>
              {match.homeTeam}
            </span>
            <span className={`${styles.teamScore} ${homeLead || drawn ? styles.won : ''}`}>
              {kickoff ? '' : match.homeScore}
            </span>
          </div>
          <div className={styles.teamLine}>
            <TeamCrest team={match.awayTeam} size={22} />
            <span className={`${styles.teamName} ${awayLead || drawn ? styles.won : ''}`}>
              {match.awayTeam}
            </span>
            <span className={`${styles.teamScore} ${awayLead || drawn ? styles.won : ''}`}>
              {kickoff ? '' : match.awayScore}
            </span>
          </div>
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
        <StarIcon size={17} filled={isSaved} />
      </button>

      {isFollowed && <span className={styles.followedEdge} aria-hidden="true" />}
    </li>
  );
}
