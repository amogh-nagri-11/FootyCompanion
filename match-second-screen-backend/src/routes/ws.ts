import { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth.js';

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws/match/:matchId', { websocket: true }, (connection, req) => {
    const token = (req.query as { token?: string }).token;

    if (!token) {
      connection.close(4001, 'Missing token');
      return;
    }

    let user;
    try {
      user = verifyToken(token);
    } catch {
      connection.close(4002, 'Invalid token');
      return;
    }

    const { matchId } = req.params as { matchId: string };
    app.log.info(`User ${user.id} connected to match ${matchId}`);

    connection.send(JSON.stringify({ type: 'connected', matchId }));

    connection.on('message', (message: Buffer) => {
      app.log.info(`Received: ${message.toString()}`);
    });

    connection.on('close', () => {
      app.log.info(`User ${user.id} disconnected from match ${matchId}`);
    });
  });
}