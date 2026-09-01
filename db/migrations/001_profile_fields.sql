-- LiveXI — profile fields
--
-- Run this against the Supabase project (SQL Editor, or psql with DATABASE_URL).
-- Every statement is idempotent, so re-running it is safe.

-- 1. Live FPL point tracking. Without this the app runs but always reports
--    "no FPL team linked".
alter table public.profiles add column if not exists fpl_team_id integer;

-- 2. Standard profile fields.
--    `username` already exists and stays the unique handle; `display_name` is
--    the free-text name shown to people, which does not need to be unique.
alter table public.profiles add column if not exists display_name   text;
alter table public.profiles add column if not exists bio            text;
alter table public.profiles add column if not exists avatar_url     text;
alter table public.profiles add column if not exists favourite_team text;
alter table public.profiles add column if not exists updated_at     timestamptz default now();

-- Keep bios to something a profile card can actually show.
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length check (bio is null or char_length(bio) <= 300);

-- Usernames are compared case-insensitively everywhere in the app, so the
-- uniqueness guarantee has to be case-insensitive too — otherwise "Amogh" and
-- "amogh" are two different accounts that look identical to a reader.
--
-- This index fails if two existing rows already differ only by case. Check
-- first, and rename one of them if this returns anything:
--
--   select lower(username), count(*) from public.profiles
--   where username is not null group by 1 having count(*) > 1;
--
-- Existing usernames are not otherwise validated: the on_auth_user_created
-- trigger seeds them from the email address, so rows predating this migration
-- may contain characters the app's own rules now reject. They keep working —
-- validation applies when a user saves, not retroactively.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

comment on column public.profiles.fpl_team_id is 'Fantasy Premier League entry id, from the user''s FPL URL.';
comment on column public.profiles.display_name is 'Shown to people; unlike username it need not be unique.';
