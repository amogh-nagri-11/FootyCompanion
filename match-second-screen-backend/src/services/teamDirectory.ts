import { cacheGetJson, cacheSetJson } from '../redis.js';
import { fixtureDateWindow, getFixturesForDate } from './matchList.js';
import { todayUtc } from './sportsApi.js';

/**
 * Resolves a typed team name to the feed's stable team id.
 *
 * Following used to store whatever string the user typed and compare it to the
 * feed with `===`, so "Man City" never matched "Manchester City", "Spurs"
 * never matched "Tottenham", and a rename upstream silently unfollowed
 * everyone. Ids do not have those problems.
 *
 * NOTE: this is deterministic string matching — normalise, then exact, then
 * prefix/containment, then a token check. There is no model involved and none
 * is warranted; the candidate set is a few hundred names from the fixture
 * feed, and a rule you can read beats one you have to trust. The same is true
 * of the FPL player matcher in `fpl/names.ts`, which is sometimes described as
 * "fuzzy" and is likewise plain code.
 *
 * The directory is built from fixtures already being fetched for the date
 * browser, so it costs no extra upstream requests in the normal case.
 */

const CACHE_KEY = 'teamdirectory:v1';
const WIDE_CACHE_KEY = 'teamdirectory:wide:v1';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

export interface TeamRef {
  id: number;
  name: string;
}

/** Lowercase, unaccented, punctuation-free, with the noise words dropped. */
export function normaliseTeam(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Full stops go first, so a dotted abbreviation collapses to a word the
    // club-type rule below can see: "F.C." -> "fc", not "f c".
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    // Club-type words carry no identity: "Manchester City FC" is "Manchester
    // City", and "AFC Bournemouth" is "Bournemouth".
    .replace(/\b(fc|afc|cf|sc|ac|club|city of|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Common short forms the feed never uses but people type. */
const ALIASES: Record<string, string> = {
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  spurs: 'tottenham',
  wolves: 'wolverhampton wanderers',
  barca: 'barcelona',
  psg: 'paris saint germain',
  inter: 'internazionale',
  atleti: 'atletico madrid',
  gunners: 'arsenal',
};

/** Collects team ids from one day's fixtures into `teams`. Never throws. */
async function harvest(date: string, teams: Map<number, string>): Promise<void> {
  try {
    const { matches } = await getFixturesForDate(date);
    for (const m of matches) {
      if (m.homeTeamId) teams.set(m.homeTeamId, m.homeTeam);
      if (m.awayTeamId) teams.set(m.awayTeamId, m.awayTeam);
    }
  } catch {
    // A day that cannot be fetched simply contributes no teams. Follows still
    // work by name, so a partial directory is better than a failed request.
  }
}

/**
 * Teams seen today, cached.
 *
 * Only today, because that day's fixtures are already fetched and cached for
 * the date browser — so the common path costs nothing extra against a 100/day
 * budget. `widenDirectory` covers the rest, and only when it is needed.
 */
async function loadDirectory(): Promise<TeamRef[]> {
  const cached = await cacheGetJson<TeamRef[]>(CACHE_KEY);
  if (cached) return cached;

  const teams = new Map<number, string>();
  await harvest(todayUtc(), teams);

  const list = [...teams.entries()].map(([id, name]) => ({ id, name }));
  if (list.length > 0) await cacheSetJson(CACHE_KEY, list, CACHE_TTL_SECONDS);
  return list;
}

/**
 * The same, across every day the plan will serve.
 *
 * Only reached when a name did not resolve against today, because a club that
 * is not playing today is absent from today's fixtures entirely — which is the
 * common case for any given team on any given day. Those extra days are cached
 * by the date browser too, so the cost is at most one request per day in the
 * window, once.
 */
async function widenDirectory(): Promise<TeamRef[]> {
  const cached = await cacheGetJson<TeamRef[]>(WIDE_CACHE_KEY);
  if (cached) return cached;

  const { from, to } = fixtureDateWindow();
  const teams = new Map<number, string>();

  for (let date = from; date <= to; date = shiftDay(date, 1)) {
    await harvest(date, teams);
  }

  const list = [...teams.entries()].map(([id, name]) => ({ id, name }));
  if (list.length > 0) await cacheSetJson(WIDE_CACHE_KEY, list, CACHE_TTL_SECONDS);
  return list;
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Best id for `input`, or null when nothing matches confidently.
 *
 * Returning null is deliberate: an unresolved follow still works by name, so
 * a wrong id is strictly worse than no id.
 */
export async function resolveTeamId(input: string): Promise<TeamRef | null> {
  const wanted = ALIASES[normaliseTeam(input)] ?? normaliseTeam(input);
  if (!wanted) return null;

  const found = pick(await loadDirectory(), wanted);
  if (found) return found;

  // A club not playing today is simply absent from today's fixtures, so a miss
  // here is the normal case rather than evidence the name is wrong.
  return pick(await widenDirectory(), wanted);
}

/** Runs the match ladder against one candidate list. */
function pick(directory: TeamRef[], wanted: string): TeamRef | null {
  if (directory.length === 0) return null;

  const scored = directory.map((team) => ({ team, key: normaliseTeam(team.name) }));

  const exact = scored.find((c) => c.key === wanted);
  if (exact) return exact.team;

  // One-sided containment, longest first: "tottenham" matches "tottenham
  // hotspur", and the longer candidate is the more specific one.
  const contained = scored
    .filter((c) => c.key.startsWith(`${wanted} `) || c.key === wanted || wanted.startsWith(`${c.key} `))
    .sort((a, b) => b.key.length - a.key.length);
  if (contained.length === 1) return contained[0].team;

  // Every word of the input appears in the candidate. Ambiguity is a
  // non-answer: "united" hits a dozen clubs and guessing one is worse.
  const words = wanted.split(' ').filter(Boolean);
  const tokenMatches = scored.filter((c) => {
    const candidateWords = new Set(c.key.split(' '));
    return words.every((w) => candidateWords.has(w));
  });
  if (tokenMatches.length === 1) return tokenMatches[0].team;

  return null;
}

/**
 * Whether a fixture involves a followed team.
 *
 * Ids win when both sides have one. The name comparison is the fallback for
 * rows created before ids existed, and is normalised so at least the trivial
 * spelling differences match.
 */
export function fixtureMatchesFollow(
  fixture: { homeTeam: string; awayTeam: string; homeTeamId: number | null; awayTeamId: number | null },
  follow: { teamId: number | null; teamName: string }
): boolean {
  if (follow.teamId !== null) {
    if (fixture.homeTeamId === follow.teamId || fixture.awayTeamId === follow.teamId) return true;
    // An id that matches neither side is not proof of a miss: the fixture may
    // predate ids. Fall through to the name check rather than returning false.
  }

  const wanted = normaliseTeam(follow.teamName);
  return normaliseTeam(fixture.homeTeam) === wanted || normaliseTeam(fixture.awayTeam) === wanted;
}
