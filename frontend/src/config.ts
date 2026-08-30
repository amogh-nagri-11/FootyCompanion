interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  wsUrl: string;
  matchId: string;
}

/**
 * Missing env vars are reported through the UI rather than thrown at module
 * load, which would blank the page with nothing but a console error.
 */
export const configError: string | null = (() => {
  const missing = (['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const).filter(
    (key) => !import.meta.env[key]?.trim()
  );
  return missing.length > 0 ? missing.join(', ') : null;
})();

// Values pasted into .env pick up stray whitespace easily, and a trailing
// space in a URL fails in ways that are tedious to trace back here.
const clean = (v: string | undefined, fallback = '') => (v ?? fallback).trim();

export const config: Config = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: clean(import.meta.env.VITE_SUPABASE_ANON_KEY),
  wsUrl: clean(import.meta.env.VITE_WS_URL, 'ws://localhost:4000').replace(/\/+$/, ''),
  // Match selection is out of scope for this pass — one hardcoded match.
  matchId: clean(import.meta.env.VITE_MATCH_ID, 'test789'),
};
