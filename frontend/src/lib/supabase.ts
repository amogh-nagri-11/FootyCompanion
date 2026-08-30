import { createClient } from '@supabase/supabase-js';
import { config, configError } from '../config';

// Placeholders keep createClient from throwing when env vars are absent; App
// renders a setup message instead of ever reaching an auth call.
export const supabase = createClient(
  configError ? 'http://localhost' : config.supabaseUrl,
  configError ? 'missing-anon-key' : config.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
