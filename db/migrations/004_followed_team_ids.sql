-- LiveXI — follow teams by stable id, not by typed name
--
-- Run against the Supabase project (SQL Editor, or psql with DATABASE_URL).
-- Idempotent; safe to re-run.
--
-- `followed_teams` matched the feed on the exact string a user typed, so
-- "Man City" never matched "Manchester City" and a rename upstream silently
-- unfollowed everyone. API-Football gives every team a numeric id that is
-- stable across seasons and spellings, so that becomes the identity and the
-- name is kept only for display.
--
-- Nullable rather than NOT NULL: existing rows were typed by hand and cannot
-- all be resolved to an id, so the matcher falls back to the name for those.
-- Backfill with `npm run backfill:team-ids` once this is applied.

alter table public.followed_teams
  add column if not exists team_id integer;

comment on column public.followed_teams.team_id is
  'API-Football team id. Null for rows created before this migration, or for '
  'a name the fixture feed could not resolve — those still match by name.';

-- One row per user per team once resolved. Partial, so the many null-id rows
-- do not collide with each other while the backfill is pending.
create unique index if not exists followed_teams_user_team_id_idx
  on public.followed_teams (user_id, team_id)
  where team_id is not null;

create index if not exists followed_teams_team_id_idx
  on public.followed_teams (team_id)
  where team_id is not null;
