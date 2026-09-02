import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';
import { resolveTeamId } from '../services/teamDirectory.js';

export async function followRoutes(app: FastifyInstance) {
  app.get('/follows', { preHandler: requireAuth }, async (req, reply) => {
    const { data, error } = await req.db!.from('followed_teams')
      .select('team_name, team_id, created_at')
      .eq('user_id', req.user!.id)
      .order('team_name');
    if (error) return reply.code(400).send({ error: error.message });
    return { teams: data };
  });

  app.post('/follows', { preHandler: requireAuth }, async (req, reply) => {
    const { teamName } = (req.body ?? {}) as { teamName?: string };
    const trimmed = teamName?.trim();
    if (!trimmed) return reply.code(400).send({ error: 'teamName is required' });

    // Resolve to the feed's own id so the follow survives a different spelling
    // or a rename. Unresolved is not an error: the row still matches by name,
    // and a wrong id would be worse than none.
    const resolved = await resolveTeamId(trimmed);

    const { error } = await req.db!.from('followed_teams')
      .upsert(
        {
          user_id: req.user!.id,
          // Store the feed's canonical spelling when we have it, so the list
          // reads consistently rather than echoing back "man city".
          team_name: resolved?.name ?? trimmed,
          team_id: resolved?.id ?? null,
        },
        { onConflict: 'user_id,team_name' }
      );
    if (error) {
      // The column is added by db/migrations/004. Until that is applied, fall
      // back to a name-only insert rather than breaking the feature.
      if (/team_id/.test(error.message)) {
        const { error: retry } = await req.db!.from('followed_teams')
          .upsert(
            { user_id: req.user!.id, team_name: resolved?.name ?? trimmed },
            { onConflict: 'user_id,team_name' }
          );
        if (retry) return reply.code(400).send({ error: retry.message });
        return {
          following: true,
          teamName: resolved?.name ?? trimmed,
          teamId: null,
          migrationPending: true,
        };
      }
      return reply.code(400).send({ error: error.message });
    }

    return {
      following: true,
      teamName: resolved?.name ?? trimmed,
      teamId: resolved?.id ?? null,
      /** True when the typed name could not be matched to a feed team. */
      unresolved: resolved === null,
    };
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
