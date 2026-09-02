import { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseClient } from '@supabase/supabase-js';
import { verifyToken, AuthedUser } from './auth.js';
import { supabaseForUser } from './supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    /**
     * Supabase client acting as the caller, so RLS applies to every query.
     * Routes still filter by `req.user.id` where it makes the intent clear,
     * but the database is what enforces it.
     */
    db?: SupabaseClient;
  }
}

/*
 * Access control is enforced by the database.
 *
 * `req.db` carries the caller's JWT, so the existing policies ("users manage
 * own …") decide what each query can see, and `auth.uid()` resolves to the
 * caller. This is the arrangement db/migrations/002 exists to enable: before
 * those grants, the `authenticated` role had no DML on any application table,
 * so a JWT-scoped client failed with "permission denied for table" before RLS
 * was ever consulted, and the backend had to use the service-role client and
 * scope every query by hand.
 *
 * That hand-scoping was one forgotten `.eq('user_id', …)` away from leaking
 * another user's rows. Now a forgotten filter returns nothing instead.
 *
 * The service-role client still exists for work with no caller behind it — the
 * poller archiving a finished match, reading a user's FPL id for their socket.
 */

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return reply.code(401).send({ error: 'Missing Authorization bearer token' });
  }

  try {
    req.user = await verifyToken(token);
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  req.db = supabaseForUser(token);
}
