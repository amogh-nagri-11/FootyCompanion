import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';
import { getFplTeamId, setFplTeamId } from '../services/fpl/store.js';
import { entryExists, FplError } from '../services/fpl/client.js';
import { getSquad } from '../services/fpl/squad.js';

export async function fplRoutes(app: FastifyInstance) {
  app.get('/fpl/team', { preHandler: requireAuth }, async (req, reply) => {
    try {
      return { fplTeamId: await getFplTeamId(req.db!, req.user!.id) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.put('/fpl/team', { preHandler: requireAuth }, async (req, reply) => {
    const { teamId } = (req.body ?? {}) as { teamId?: number | string };
    const parsed = Number(teamId);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return reply.code(400).send({
        error: 'teamId must be a positive whole number — the digits in your FPL team URL.',
      });
    }

    try {
      // Check it is a real entry before storing, so a typo surfaces here rather
      // than as an empty squad panel later.
      if (!(await entryExists(parsed))) {
        return reply.code(404).send({ error: `No FPL team found with id ${parsed}.` });
      }
      await setFplTeamId(req.db!, req.user!.id, parsed);
      return { fplTeamId: parsed };
    } catch (err) {
      if (err instanceof FplError) return reply.code(502).send({ error: err.message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/fpl/team', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await setFplTeamId(req.db!, req.user!.id, null);
      return { fplTeamId: null };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/fpl/squad', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const teamId = await getFplTeamId(req.db!, req.user!.id);
      if (teamId === null) return reply.code(404).send({ error: 'No FPL team linked' });

      const squad = await getSquad(teamId);
      if (!squad) return reply.code(404).send({ error: 'No active gameweek' });
      return squad;
    } catch (err) {
      if (err instanceof FplError) return reply.code(502).send({ error: err.message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
