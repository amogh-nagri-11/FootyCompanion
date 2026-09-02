import type { MatchSummary } from '../types';

/**
 * Client-side twin of the backend's team matcher.
 *
 * The list screens filter and highlight locally, so they need the same rule
 * the server uses when it resolves a follow. Kept deliberately small and
 * mirrored rather than shared through an API round trip.
 *
 * This is plain deterministic string work — normalise, then compare — with no
 * model involved. See `services/teamDirectory.ts` for the authoritative copy.
 */

export interface FollowRef {
  teamName: string;
  /** Null for follows created before ids existed, or names the feed rejected. */
  teamId: number | null;
}

/** Lowercase, unaccented, punctuation-free, with the club-type words dropped. */
export function normaliseTeam(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Full stops go first, so a dotted abbreviation collapses to a word the
    // club-type rule below can see: "F.C." -> "fc", not "f c".
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|afc|cf|sc|ac|club|city of|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a fixture involves a followed team.
 *
 * Ids decide it when they match. A non-matching id is not proof of a miss —
 * the follow may predate ids, or the fixture may not carry them — so the
 * normalised name is still checked afterwards.
 */
export function matchesFollow(fixture: MatchSummary, follow: FollowRef): boolean {
  if (
    follow.teamId !== null &&
    (fixture.homeTeamId === follow.teamId || fixture.awayTeamId === follow.teamId)
  ) {
    return true;
  }

  const wanted = normaliseTeam(follow.teamName);
  return (
    normaliseTeam(fixture.homeTeam) === wanted || normaliseTeam(fixture.awayTeam) === wanted
  );
}

/** True when any of `follows` is playing in this fixture. */
export function matchesAnyFollow(fixture: MatchSummary, follows: FollowRef[]): boolean {
  return follows.some((f) => matchesFollow(fixture, f));
}

/**
 * Whether one team, by name, is among the follows.
 *
 * Used where the subject is a team rather than a fixture (the follow button on
 * a match page). Normalised, so a follow saved under a different spelling
 * still shows as followed instead of offering to follow it twice.
 */
export function isTeamFollowed(teamName: string, follows: FollowRef[]): boolean {
  const wanted = normaliseTeam(teamName);
  return follows.some((f) => normaliseTeam(f.teamName) === wanted);
}
