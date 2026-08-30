import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';
import { getLiveFixtures } from '../services/matchList.js';

export async function matchRoutes(app: FastifyInstance) {
  app.get('/matches/live', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { matches, cached } = await getLiveFixtures();
      return { matches, cached };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to load live matches',
      });
    }
  });

  app.get('/matches/saved', { preHandler: requireAuth }, async (req, reply) => {
    const { data, error } = await req.db!.from('saved_matches')
      .select('match_id, created_at')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: data };
  });

  app.post('/matches/:matchId/save', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    // Ignore a repeat save rather than failing on the (user_id, match_id) unique.
    const { error } = await req.db!.from('saved_matches')
      .upsert({ user_id: req.user!.id, match_id: matchId }, { onConflict: 'user_id,match_id' });
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: true, matchId };
  });

  app.delete('/matches/:matchId/save', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { error } = await req.db!.from('saved_matches')
      .delete()
      .eq('user_id', req.user!.id)
      .eq('match_id', matchId);
    if (error) return reply.code(400).send({ error: error.message });
    return { saved: false, matchId };
  });

  app.get('/matches/archive', { preHandler: requireAuth }, async (req, reply) => {
    const { team, limit } = req.query as { team?: string; limit?: string };
    let query = req.db!.from('match_archive')
      .select('match_id, home_team, away_team, final_score, summary, played_at')
      .order('played_at', { ascending: false })
      .limit(Math.min(Number(limit) || 50, 100));

    if (team) query = query.or(`home_team.ilike.%${team}%,away_team.ilike.%${team}%`);

    const { data, error } = await query;
    if (error) return reply.code(400).send({ error: error.message });
    return { matches: data };
  });

  app.get('/matches/archive/:matchId', { preHandler: requireAuth }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const { data, error } = await req.db!.from('match_archive')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();
    if (error) return reply.code(400).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Not in the archive' });
    return data;
  });
}
