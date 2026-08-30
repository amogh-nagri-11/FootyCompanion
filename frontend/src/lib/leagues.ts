/**
 * Competitions pinned above the long alphabetical tail. Order here is the order
 * they appear, so it reads as importance rather than alphabetically.
 *
 * `country` disambiguates names the feed reuses across countries — there are
 * Premier Leagues in England, Armenia, Belarus, Russia, Uganda and more, and a
 * Serie A in both Italy and Brazil. A null country matches any.
 */
const MAJOR_LEAGUES: { league: string; country: string | null }[] = [
  { league: 'UEFA Champions League', country: null },
  { league: 'UEFA Europa League', country: null },
  { league: 'UEFA Europa Conference League', country: null },
  { league: 'Premier League', country: 'England' },
  { league: 'La Liga', country: 'Spain' },
  { league: 'Serie A', country: 'Italy' },
  { league: 'Bundesliga', country: 'Germany' },
  { league: 'Ligue 1', country: 'France' },
  { league: 'Primeira Liga', country: 'Portugal' },
  { league: 'Eredivisie', country: 'Netherlands' },
  { league: 'Championship', country: 'England' },
  { league: 'Serie A', country: 'Brazil' },
  { league: 'Liga Profesional Argentina', country: 'Argentina' },
  { league: 'Major League Soccer', country: 'USA' },
];

/** Position in the pinned list, or -1 when the league is not a major. */
export function majorLeagueRank(league: string, country: string | null): number {
  return MAJOR_LEAGUES.findIndex(
    (m) => m.league === league && (m.country === null || m.country === country)
  );
}

export const TIER_LABELS = ['Your teams', 'Major competitions', 'All other leagues'] as const;
export type Tier = 0 | 1 | 2;
