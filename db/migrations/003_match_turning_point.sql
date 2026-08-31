-- FootyCompanion — store the computed turning point on archived matches
--
-- Run against the Supabase project (SQL Editor, or psql with DATABASE_URL).
-- Idempotent; safe to re-run.
--
-- The turning point is calculated deterministically from the win-probability
-- time series at full time (largest swing in home win probability over a window
-- of up to 5 match minutes). It is real structured data, not prose, so it gets
-- a column rather than being folded into `summary`.
--
-- jsonb rather than scalar columns, matching how `event_log` already stores
-- structured data on this table: one column holds the minute, the signed delta,
-- the probabilities either side of the swing, and the events that caused it,
-- and the shape can grow without another migration.
--
-- Until this is applied the app still archives every finished match — the
-- turning point is simply dropped, and the backend logs the fact once.

alter table public.match_archive
  add column if not exists turning_point jsonb;

comment on column public.match_archive.turning_point is
  'Deterministically computed match turning point: '
  '{ minute, fromMinute, delta, favoured, before, after, events }. '
  'Null when win probability never swung sharply enough to name a moment.';

-- Sorting the archive by "most dramatic match" is the obvious use, and it needs
-- no extra columns — the delta is indexable straight out of the jsonb.
create index if not exists match_archive_turning_point_delta_idx
  on public.match_archive ((abs(((turning_point ->> 'delta'))::numeric)) desc)
  where turning_point is not null;
