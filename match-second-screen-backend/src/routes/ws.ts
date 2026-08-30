import { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth.js';
import { subscribe, unsubscribe, broadcast, hasSubscribers } from '../services/connectionRegistry.js';
import { startPolling, stopPolling, getLastKnownState } from '../services/matchPoller.js';

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

    subscribe(matchId, connection);

    // start polling this match if it isn't already being tracked
    startPolling(matchId, (id, newEvents, state, winProb) => {
      broadcast(id, { type: 'update', events: newEvents, state, winProb });
    });

    connection.send(JSON.stringify({ type: 'connected', matchId }));

    // Bring a client joining an already-tracked match up to date immediately,
    // rather than leaving it on "waiting for match data" until the next event.
    const known = getLastKnownState(matchId);
    if (known) {
      connection.send(
        JSON.stringify({
          type: 'update',
          events: known.state.events,
          state: known.state,
          winProb: known.winProb,
        })
      );
    }

    connection.on('close', () => {
      app.log.info(`User ${user.id} disconnected from match ${matchId}`);
      unsubscribe(matchId, connection);

      if (!hasSubscribers(matchId)) {
        app.log.info(`No subscribers left for ${matchId}, stopping poll`);
        stopPolling(matchId);
      }
    });
  });
}