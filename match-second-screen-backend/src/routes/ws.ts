import { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth.js';
import {
  subscribe,
  unsubscribe,
  broadcast,
  hasSubscribers,
  send,
} from '../services/connectionRegistry.js';
import { startPolling, stopPolling, getLastKnownState } from '../services/matchPoller.js';
import { getFeedHealth } from '../services/feedHealth.js';
import { loadMomentum } from '../services/momentum.js';
import { supabaseAdmin } from '../supabase.js';
import { getFplTeamId } from '../services/fpl/store.js';
import { onMatchUpdate, pushSquadUpdate } from '../services/fpl/liveBridge.js';

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws/match/:matchId', { websocket: true }, async (connection, req) => {
    const token = (req.query as { token?: string }).token;

    if (!token) {
      connection.close(4001, 'Missing token');
      return;
    }

    let user;
    try {
      user = await verifyToken(token);
    } catch {
      connection.close(4002, 'Invalid token');
      return;
    }

    const { matchId } = req.params as { matchId: string };
    app.log.info(`User ${user.id} connected to match ${matchId}`);

    // Read once at connect: picks are per-user, but the FPL endpoints behind
    // them are fetched once and shared, so this costs nothing per subscriber.
    let fplTeamId: number | null = null;
    try {
      fplTeamId = await getFplTeamId(supabaseAdmin, user.id);
    } catch (err) {
      app.log.warn(`Could not read FPL team for ${user.id}: ${(err as Error).message}`);
    }

    const subscriber = subscribe(matchId, connection, user.id, fplTeamId);

    startPolling(
      matchId,
      (id, newEvents, state, winProb, momentum) => {
        broadcast(id, { type: 'update', events: newEvents, state, winProb, momentum });
        void onMatchUpdate(id, newEvents, state);
      },
      // Everyone watching sees the same feed, so its health is broadcast, not
      // sent to whoever happened to trigger the failing poll.
      (id, health) => broadcast(id, { type: 'feed_health', matchId: id, health })
    );

    send(subscriber, { type: 'connected', matchId, fplLinked: fplTeamId !== null });

    // A client joining a feed that is already unhealthy needs to be told now;
    // the next broadcast only fires when the status changes again.
    const health = getFeedHealth(matchId);
    if (health.status !== 'ok') {
      send(subscriber, { type: 'feed_health', matchId, health });
    }

    // Bring a client joining an already-tracked match up to date immediately,
    // rather than leaving it on "waiting for match data" until the next event.
    const known = getLastKnownState(matchId);
    if (known) {
      send(subscriber, {
        type: 'update',
        events: known.state.events,
        state: known.state,
        // In-memory momentum is authoritative; the stored copy covers the case
        // where this process restarted and has not polled yet.
        momentum: known.momentum ?? (await loadMomentum(matchId)) ?? undefined,
        winProb: known.winProb,
      });
    }

    // Populate the FPL panel on connect so it is not blank until a goal.
    void pushSquadUpdate(subscriber, matchId);

    connection.on('close', () => {
      app.log.info(`User ${user.id} disconnected from match ${matchId}`);
      unsubscribe(matchId, subscriber);

      if (!hasSubscribers(matchId)) {
        app.log.info(`No subscribers left for ${matchId}, stopping poll`);
        stopPolling(matchId);
      }
    });
  });
}
