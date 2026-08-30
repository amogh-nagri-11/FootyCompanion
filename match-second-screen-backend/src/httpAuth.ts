import { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseClient } from '@supabase/supabase-js';
import { verifyToken, AuthedUser } from './auth.js';
import { supabaseAdmin } from './supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    /**
     * Service-role Supabase client. RLS does NOT apply to it, so every query
     * touching a user-owned table MUST filter on `req.user.id` explicitly.
     * See the note on `db` below.
     */
    db?: SupabaseClient;
  }
}

/*
 * Ideally this would attach a client carrying the caller's JWT so the existing
 * RLS policies ("users manage own …") did the access control. They cannot: the
 * `authenticated` role has no SELECT/INSERT/UPDATE/DELETE grant on any of these
 * tables, so such a client gets "permission denied for table …" before RLS is
 * ever consulted, and only `service_role` has DML.
 *
 * So we use the service-role client and scope by user id in each query. That is
 * safe only because the browser never talks to Postgres directly — every write
 * goes through these routes. If the grants are added later (see README), swap
 * this for a per-request JWT client and RLS becomes the enforcing layer again.
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

  req.db = supabaseAdmin;
}
