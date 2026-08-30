import { Subscriber, getSubscribers, send } from '../connectionRegistry.js';
import { LiveMatchState, MatchEvent } from '../sportsApi.js';
import { getBootstrap, getCurrentGameweek, getPicks } from './client.js';
import { buildIndex, PlayerIndex, resolvePlayer, resolveTeam } from './names.js';
import { getSquad } from './squad.js';

// Rebuilding the index is cheap, but it runs on every poll for every match, so
// hold it briefly rather than re-deriving 600+ players each time.
const INDEX_TTL_MS = 5 * 60 * 1000;
let cachedIndex: { index: PlayerIndex; builtAt: number } | null = null;

async function getIndex(): Promise<PlayerIndex> {
  if (cachedIndex && Date.now() - cachedIndex.builtAt < INDEX_TTL_MS) return cachedIndex.index;
  const index = buildIndex(await getBootstrap());
  cachedIndex = { index, builtAt: Date.now() };
  return index;
}

/** The names a single event puts on the pitch, with the role each played. */
function namesInEvent(event: MatchEvent): { name: string; role: 'scorer' | 'assist' }[] {
  const out: { name: string; role: 'scorer' | 'assist' }[] = [];

  if (event.playerName || event.assistName) {
    if (event.playerName) out.push({ name: event.playerName, role: 'scorer' });
    if (event.assistName) out.push({ name: event.assistName, role: 'assist' });
    return out;
  }

  // Fallback for events stored before the raw names were carried (the archive
  // holds older rows): recover them from the rendered sentence.
  const [primaryPart, assistPart] = event.detail.split(', assist ');
  const primary = primaryPart.split(' — ')[0].split(' (')[0].split(' on for ')[0].trim();
  if (primary) out.push({ name: primary, role: 'scorer' });
  if (assistPart) out.push({ name: assistPart.trim(), role: 'assist' });
  return out;
}

/** Sends each subscriber their own squad totals, straight from FPL's numbers. */
export async function pushSquadUpdate(subscriber: Subscriber, matchId: string): Promise<void> {
  if (!subscriber.fplTeamId) return;
  try {
    const squad = await getSquad(subscriber.fplTeamId);
    if (!squad) return;
    send(subscriber, { type: 'fpl_update', matchId, ...squad });
  } catch (err) {
    // The match feed must not degrade because FPL is unavailable.
    console.error('FPL squad update failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Called when the match poller reports new events.
 *
 * Alerts fire first and use only cached data, so "your player just scored" lands
 * as soon as the event does. The authoritative point values follow from FPL's
 * live endpoint a moment later — instant feel, correct numbers, rather than
 * choosing one.
 */
export async function onMatchUpdate(
  matchId: string,
  newEvents: MatchEvent[],
  state: LiveMatchState
): Promise<void> {
  const subscribers = getSubscribers(matchId).filter((s) => s.fplTeamId);
  if (subscribers.length === 0) return;

  try {
    const index = await getIndex();
    const homeTeamId = resolveTeam(index, state.homeTeam);
    const awayTeamId = resolveTeam(index, state.awayTeam);

    // Not a Premier League fixture — nothing here can affect an FPL squad.
    if (homeTeamId === null && awayTeamId === null) return;

    const gameweek = await getCurrentGameweek();

    if (gameweek !== null && newEvents.length > 0) {
      // Resolve every name once, then fan out to subscribers.
      const resolved = newEvents.flatMap((event) => {
        const teamId = resolveTeam(index, event.team);
        return namesInEvent(event)
          .map(({ name, role }) => {
            const element = resolvePlayer(index, name, teamId ?? homeTeamId ?? awayTeamId);
            return element ? { event, role, element } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      });

      if (resolved.length > 0) {
        for (const subscriber of subscribers) {
          try {
            const picks = await getPicks(subscriber.fplTeamId!, gameweek);
            const owned = new Map(picks.picks.map((p) => [p.element, p]));

            for (const { event, role, element } of resolved) {
              const pick = owned.get(element.id);
              if (!pick) continue;
              send(subscriber, {
                type: 'fpl_alert',
                matchId,
                gameweek,
                role,
                player: { fplId: element.id, name: element.web_name },
                isCaptain: pick.is_captain,
                onBench: pick.position > 11,
                multiplier: pick.multiplier,
                event: { minute: event.minute, type: event.type, detail: event.detail },
              });
            }
          } catch (err) {
            console.error('FPL alert failed:', err instanceof Error ? err.message : err);
          }
        }
      }
    }

    // Reconcile against FPL's own live points.
    await Promise.all(subscribers.map((s) => pushSquadUpdate(s, matchId)));
  } catch (err) {
    console.error('FPL bridge error:', err instanceof Error ? err.message : err);
  }
}
