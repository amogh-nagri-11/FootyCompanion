-- LiveXI — restore RLS as the enforcing layer (OPTIONAL)
--
-- The `authenticated` role currently has no DML grant on any application table,
-- so the RLS policies that exist ("users manage own …") are unreachable: a
-- JWT-scoped client fails with "permission denied for table" before RLS is ever
-- consulted. The backend works around this by using the service-role client and
-- scoping every query by user id itself.
--
-- Applying this makes the database the enforcing layer again. After running it,
-- switch `requireAuth` in src/httpAuth.ts back to a per-request client carrying
-- the caller's JWT (see the comment there).

grant select, insert, update, delete
  on public.profiles, public.followed_teams, public.saved_matches
  to authenticated;

grant select on public.match_archive to authenticated, anon;
