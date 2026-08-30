import { SupabaseClient } from '@supabase/supabase-js';

const MISSING_COLUMN_HINT =
  'profiles.fpl_team_id is missing. Run: ' +
  'alter table public.profiles add column if not exists fpl_team_id integer;';

let warned = false;

function isMissingColumn(message: string): boolean {
  return message.includes('fpl_team_id');
}

/**
 * The caller's saved FPL entry id, or null when they have not linked one.
 *
 * Treats a missing column as "not linked" rather than throwing: the FPL feature
 * is additive, and a database that has not had the migration applied should
 * leave the rest of the app working.
 */
export async function getFplTeamId(
  db: SupabaseClient,
  userId: string
): Promise<number | null> {
  const { data, error } = await db
    .from('profiles')
    .select('fpl_team_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingColumn(error.message)) {
      if (!warned) {
        console.warn(MISSING_COLUMN_HINT);
        warned = true;
      }
      return null;
    }
    throw new Error(error.message);
  }

  return (data?.fpl_team_id as number | null) ?? null;
}

export async function setFplTeamId(
  db: SupabaseClient,
  userId: string,
  teamId: number | null
): Promise<void> {
  const { error } = await db
    .from('profiles')
    .update({ fpl_team_id: teamId })
    .eq('id', userId);

  if (error) {
    throw new Error(isMissingColumn(error.message) ? MISSING_COLUMN_HINT : error.message);
  }
}
