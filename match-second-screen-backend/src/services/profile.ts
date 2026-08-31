import { SupabaseClient } from '@supabase/supabase-js';

/** Columns that exist in the base schema and are always safe to select. */
const BASE_COLUMNS = 'id, username, created_at';

/** Columns added by db/migrations/001_profile_fields.sql. */
const EXTENDED_COLUMNS =
  'id, username, created_at, display_name, bio, avatar_url, favourite_team, fpl_team_id, updated_at';

export interface ProfileRow {
  id: string;
  username: string | null;
  created_at: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  favourite_team?: string | null;
  fpl_team_id?: number | null;
  updated_at?: string | null;
}

export interface ProfileFields {
  username?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  favourite_team?: string | null;
}

/**
 * Whether this Postgres error is "you asked for a column that isn't there".
 * 42703 is undefined_column; PostgREST also reports it as PGRST204 when the
 * column is missing from its schema cache.
 */
function isUnknownColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist|Could not find the '.*' column/i.test(error.message ?? '')
  );
}

/*
 * The migration that adds the extended columns may not have been applied yet, so
 * every read and write falls back to the base schema rather than failing. The
 * result is cached after the first attempt: without it, every request on an
 * un-migrated database would pay for two round trips.
 */
let extendedAvailable: boolean | null = null;

export function migrationPending(): boolean {
  return extendedAvailable === false;
}

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    'profiles is missing the extended profile columns. ' +
      'Run db/migrations/001_profile_fields.sql to enable display name, bio, avatar, ' +
      'favourite team and FPL linking.'
  );
}

export async function getProfile(
  db: SupabaseClient,
  userId: string
): Promise<ProfileRow | null> {
  if (extendedAvailable !== false) {
    const { data, error } = await db
      .from('profiles')
      .select(EXTENDED_COLUMNS)
      .eq('id', userId)
      .maybeSingle();

    if (!error) {
      extendedAvailable = true;
      return data as ProfileRow | null;
    }
    if (!isUnknownColumn(error)) throw new Error(error.message);

    extendedAvailable = false;
    warnOnce();
  }

  const { data, error } = await db
    .from('profiles')
    .select(BASE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ProfileRow | null;
}

/** Field names the database does not have yet, so callers can report them. */
export async function updateProfile(
  db: SupabaseClient,
  userId: string,
  fields: ProfileFields
): Promise<{ profile: ProfileRow | null; skipped: string[] }> {
  const requested = Object.keys(fields) as (keyof ProfileFields)[];

  const applyWith = async (payload: ProfileFields) => {
    const patch: Record<string, unknown> = { ...payload };
    if (extendedAvailable !== false) patch.updated_at = new Date().toISOString();

    const { error } = await db.from('profiles').update(patch).eq('id', userId);
    return error;
  };

  let skipped: string[] = [];
  let error = await applyWith(fields);

  if (error && isUnknownColumn(error)) {
    extendedAvailable = false;
    warnOnce();

    // Retry with only what the base schema can store, and tell the caller what
    // was dropped rather than silently pretending the write succeeded.
    const base: ProfileFields = {};
    if ('username' in fields) base.username = fields.username;
    skipped = requested.filter((f) => f !== 'username');

    error = Object.keys(base).length > 0 ? await applyWith(base) : null;
  }

  if (error) {
    if (error.code === '23505') throw new Error('DUPLICATE_USERNAME');
    throw new Error(error.message);
  }

  return { profile: await getProfile(db, userId), skipped };
}
