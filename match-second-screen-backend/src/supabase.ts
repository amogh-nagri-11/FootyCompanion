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