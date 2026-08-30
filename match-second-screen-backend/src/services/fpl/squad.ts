import { getBootstrap, getCurrentGameweek, getLivePoints, getPicks } from './client.js';

const POSITIONS: Record<number, string> = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

export interface SquadPlayer {
  fplId: number;
  name: string;
  team: string;
  position: string;
  /** FPL's own points for this player this gameweek, before any multiplier. */
  points: number;
  /** 0 on the bench, 2 for captain, 3 under triple captain. */
  multiplier: number;
  effectivePoints: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isBench: boolean;
  minutes: number;
  goals: number;
  assists: number;
}

export interface SquadView {
  entryId: number;
  gameweek: number;
  totalPoints: number;
  benchPoints: number;
  activeChip: string | null;
  players: SquadPlayer[];
}

/**
 * The user's squad with live points.
 *
 * Point values come straight from FPL's own live endpoint and are multiplied by
 * FPL's own multiplier — no scoring rule is reimplemented here, so the totals
 * cannot drift from what the FPL app shows.
 */
export async function getSquad(entryId: number): Promise<SquadView | null> {
  const gameweek = await getCurrentGameweek();
  if (gameweek === null) return null;

  const [bootstrap, picks, live] = await Promise.all([
    getBootstrap(),
    getPicks(entryId, gameweek),
    getLivePoints(gameweek),
  ]);

  const elementsById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));

  const players: SquadPlayer[] = picks.picks.map((pick) => {
    const element = elementsById.get(pick.element);
    const stats = live.get(pick.element)?.stats;
    const points = stats?.total_points ?? 0;

    return {
      fplId: pick.element,
      name: element?.web_name ?? `Player ${pick.element}`,
      team: element ? (teamsById.get(element.team)?.short_name ?? '') : '',
      position: element ? (POSITIONS[element.element_type] ?? '') : '',
      points,
      multiplier: pick.multiplier,
      effectivePoints: points * pick.multiplier,
      isCaptain: pick.is_captain,
      isViceCaptain: pick.is_vice_captain,
      // Bench boost gives bench players a multiplier, so position is the
      // reliable signal for "was named as a substitute", not the multiplier.
      isBench: pick.position > 11,
      minutes: stats?.minutes ?? 0,
      goals: stats?.goals_scored ?? 0,
      assists: stats?.assists ?? 0,
    };
  });

  return {
    entryId,
    gameweek,
    totalPoints: players.reduce((sum, p) => sum + p.effectivePoints, 0),
    benchPoints: players
      .filter((p) => p.isBench)
      .reduce((sum, p) => sum + p.points, 0),
    activeChip: picks.active_chip,
    players,
  };
}
