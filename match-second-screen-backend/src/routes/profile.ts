import { FastifyInstance } from 'fastify';
import { requireAuth } from '../httpAuth.js';

export async function profileRoutes(app: FastifyInstance) {
  // Rows are created by the on_auth_user_created trigger, so this reads rather
  // than creates. maybeSingle keeps a missing row a 404 instead of a throw.
  app.get('/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { data, error } = await req.db!.from('profiles')
      .select('id, username, created_at')
      .eq('id', req.user!.id)
      .maybeSingle();
    if (error) return reply.code(400).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Profile not found' });
    return data;
  });

  app.patch('/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { username } = (req.body ?? {}) as { username?: string };
    const trimmed = username?.trim();

    if (!trimmed) return reply.code(400).send({ error: 'username is required' });
    if (trimmed.length > 40) {
      return reply.code(400).send({ error: 'username must be 40 characters or fewer' });
    }

    const { data, error } = await req.db!.from('profiles')
      .update({ username: trimmed })
      .eq('id', req.user!.id)
      .select('id, username, created_at')
      .maybeSingle();

    if (error) {
      // 23505 = unique_violation on profiles.username
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'That username is already taken' });
      }
      return reply.code(400).send({ error: error.message });
    }
    return data;
  });
}
