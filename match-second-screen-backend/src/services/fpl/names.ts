import { Bootstrap, FplElement } from './client.js';

/**
 * Lowercase, strip diacritics, turn punctuation into spaces, collapse runs.
 * "Bruno Guimarães" -> "bruno guimaraes", "B.Fernandes" -> "b fernandes",
 * "Nott'm Forest" -> "nott m forest".
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean);
}

/**
 * FPL's short club names against the fuller forms other feeds use. Only the
 * pairs that normalisation and substring matching cannot bridge on their own —
 * "Leeds"/"Leeds United" and "Newcastle"/"Newcastle United" fall out of the
 * substring rule below, but "Spurs"/"Tottenham" never will.
 */
const TEAM_ALIASES: Record<string, string[]> = {
  'man city': ['manchester city'],
  'man utd': ['manchester united', 'man united'],
  spurs: ['tottenham', 'tottenham hotspur'],
  'nott m forest': ['nottingham forest'],
  wolves: ['wolverhampton wanderers', 'wolverhampton'],
  'west ham': ['west ham united'],
  brighton: ['brighton hove albion', 'brighton and hove albion'],
  'sheffield utd': ['sheffield united'],
  bournemouth: ['afc bournemouth'],
};

export interface PlayerIndex {
  elements: FplElement[];
  byTeam: Map<number, FplElement[]>;
  teamIdByName: Map<string, number>;
}

export function buildIndex(bootstrap: Bootstrap): PlayerIndex {
  const byTeam = new Map<number, FplElement[]>();
  for (const element of bootstrap.elements) {
    const list = byTeam.get(element.team);
    if (list) list.push(element);
    else byTeam.set(element.team, [element]);
  }

  const teamIdByName = new Map<string, number>();
  for (const team of bootstrap.teams) {
    const key = normalize(team.name);
    teamIdByName.set(key, team.id);
    teamIdByName.set(normalize(team.short_name), team.id);
    for (const alias of TEAM_ALIASES[key] ?? []) teamIdByName.set(normalize(alias), team.id);
  }

  return { elements: bootstrap.elements, byTeam, teamIdByName };
}

/** Maps a match-feed club name onto an FPL team id, or null if it is not a PL club. */
export function resolveTeam(index: PlayerIndex, teamName: string): number | null {
  const key = normalize(teamName);
  const exact = index.teamIdByName.get(key);
  if (exact !== undefined) return exact;

  // "Leeds" vs "Leeds United", "Newcastle" vs "Newcastle United".
  for (const [name, id] of index.teamIdByName) {
    if (name.length < 4) continue; // never let a short code match by substring
    if (key.startsWith(`${name} `) || key === name || name.startsWith(`${key} `)) return id;
  }
  return null;
}

/** Levenshtein, bounded: returns `max + 1` as soon as it cannot beat `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

interface Candidate {
  element: FplElement;
  tier: number;
}

/**
 * Resolve a match-feed player name to an FPL player.
 *
 * NOT machine learning. This is a deterministic ladder of string rules —
 * normalise, exact match, surname match, then a bounded edit distance — and it
 * is described as "fuzzy" only in the everyday sense of tolerating spelling
 * variation. No model is involved, nothing is trained, and the same input
 * always gives the same output. Worth stating plainly because "fuzzy matching"
 * is easily read as a learned component, which would misdescribe both how it
 * behaves and how it fails.
 *
 * Feeds name players inconsistently — "Bukayo Saka", "B. Saka", "Saka",
 * "Paulinho" — so this walks a ladder from most to least confident and stops at
 * the first tier that produces exactly one candidate. Several candidates at the
 * same tier means the name is genuinely ambiguous (two Gabriels at one club),
 * and returning null is correct: crediting a goal to the wrong player is worse
 * than not crediting it at all.
 *
 * Passing `teamId` narrows the pool from 600+ players to one squad, which is
 * what makes surname-only names resolvable at all.
 */
export function resolvePlayer(
  index: PlayerIndex,
  playerName: string,
  teamId: number | null
): FplElement | null {
  const input = normalize(playerName);
  if (!input) return null;

  const pool = teamId !== null ? (index.byTeam.get(teamId) ?? []) : index.elements;
  const inputTokens = input.split(' ');
  const inputLast = inputTokens[inputTokens.length - 1];
  const inputFirst = inputTokens[0];

  const candidates: Candidate[] = [];

  for (const element of pool) {
    const first = normalize(element.first_name);
    const second = normalize(element.second_name);
    const web = normalize(element.web_name);
    const full = `${first} ${second}`.trim();
    const secondTokens = second.split(' ').filter(Boolean);
    const secondLast = secondTokens[secondTokens.length - 1] ?? '';

    let tier = -1;

    if (input === full) tier = 0;
    else if (input === web) tier = 1;
    else if (input === second) tier = 2;
    else if (
      // "B. Saka" — a single leading initial plus the surname.
      inputTokens.length === 2 &&
      inputFirst.length === 1 &&
      first.startsWith(inputFirst) &&
      (inputLast === second || inputLast === secondLast || inputLast === web)
    )
      tier = 3;
    else if (inputLast === secondLast && secondLast.length > 2) tier = 4;
    else if (inputLast === web && web.length > 2) tier = 5;
    else if (
      // Every token of the shorter name appears in the longer one, e.g.
      // "Gabriel Martinelli Silva" against "Gabriel Martinelli".
      inputTokens.length > 1 &&
      inputTokens.every((t) => full.includes(t))
    )
      tier = 6;
    else if (
      // Last resort, for transliteration differences between feeds:
      // "Yarmolyuk" (match feed) vs "Yarmoliuk" (FPL). Only within a known
      // squad, only for surnames long enough that a near-miss is meaningful,
      // and still subject to the uniqueness check below.
      teamId !== null &&
      inputLast.length >= 5 &&
      secondLast.length >= 5 &&
      editDistance(inputLast, secondLast, inputLast.length >= 8 ? 2 : 1) <=
        (inputLast.length >= 8 ? 2 : 1)
    )
      tier = 7;

    if (tier >= 0) candidates.push({ element, tier });
  }

  if (candidates.length === 0) return null;

  const bestTier = Math.min(...candidates.map((c) => c.tier));
  const best = candidates.filter((c) => c.tier === bestTier);

  // Ambiguous at the best tier — refuse rather than guess.
  return best.length === 1 ? best[0].element : null;
}
