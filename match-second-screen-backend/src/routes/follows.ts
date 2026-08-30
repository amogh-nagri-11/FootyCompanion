import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';

export async function followRoutes(app: FastifyInstance) {
  app.get('/follows', { preHandler: requireAuth }, async (req, reply) => {
    const { data, error } = await req.db!.from('followed_teams')
      .select('team_name, created_at')
      .eq('user_id', req.user!.id)
      .order('team_name');
    if (error) return reply.code(400).send({ error: error.message });
    return { teams: data };
  });

  app.post('/follows', { preHandler: requireAuth }, async (req, reply) => {
    const { teamName } = (req.body ?? {}) as { teamName?: string };
    const trimmed = teamName?.trim();
    if (!trimmed) return reply.code(400).send({ error: 'teamName is required' });

    // Following twice is a no-op, not an error against the composite unique.
    const { error } = await req.db!.from('followed_teams')
      .upsert(
        { user_id: req.user!.id, team_name: trimmed },
        { onConflict: 'user_id,team_name' }
      );
    if (error) return reply.code(400).send({ error: error.message });
    return { following: true, teamName: trimmed };
  });

  app.delete('/follows/:teamName', { preHandler: requireAuth }, async (req, reply) => {
    const { teamName } = req.params as { teamName: string };
    const { error } = await req.db!.from('followed_teams')
      .delete()
      .eq('user_id', req.user!.id)
      .eq('team_name', teamName);
    if (error) return reply.code(400).send({ error: error.message });
    return { following: false, teamName };
  });
}
