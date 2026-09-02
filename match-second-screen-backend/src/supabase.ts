import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from './config.js';

export const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as any },
  }
);

/**
 * A client that acts as the calling user, so RLS is the enforcing layer.
 *
 * Built per request because the JWT is per request. It uses the anon key with
 * the caller's token attached, which is what makes `auth.uid()` resolve inside
 * the policies — the service-role client bypasses RLS entirely and cannot be
 * used for this.
 *
 * Deliberately no session persistence or token refresh: this client lives for
 * one request and must never mutate shared auth state.
 */
export function supabaseForUser(accessToken: string) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // supabase-js constructs its realtime client eagerly and Node 20 has no
    // native WebSocket, so it throws on construction without this — even
    // though these request-scoped clients never open a channel.
    realtime: { transport: ws as any },
  });
}
