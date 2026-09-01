# LiveXI — frontend

React + TypeScript + Vite second-screen view for a single live match.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5173
```

The backend must be running separately (`cd ../match-second-screen-backend && npm run dev`).

### Environment

| Variable                 | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL (same project as the backend)   |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key                                    |
| `VITE_WS_URL`            | Backend websocket origin, e.g. `ws://localhost:4000` |
| `VITE_API_URL`           | Backend REST origin. Defaults to `VITE_WS_URL` over http. |
| `VITE_MATCH_ID`          | Unused fallback; the app now lists matches.          |

With `USE_MOCK_SPORTS_DATA=false` on the backend, `VITE_MATCH_ID` must be a real
API-Football **fixture id**, not an arbitrary string. Fixture ids change daily,
so there is no lasting default — list what is in play right now with:

```bash
curl -s -H "x-apisports-key: $API_FOOTBALL_KEY" \
  https://v3.football.api-sports.io/fixtures?live=all \
  | jq -r '.response[] | "\(.fixture.id)  \(.teams.home.name) v \(.teams.away.name)"'
```

Picking a fixture in the UI is not built yet — see the note at the end.

## How it talks to the backend

Auth is Supabase email/password. The access token from `supabase.auth.getSession()`
is passed as a query param to `${VITE_WS_URL}/ws/match/:matchId?token=…`.

Two message types arrive on that socket:

- `{ type: "connected", matchId }` — sent once, immediately after auth.
- `{ type: "update", events, state, winProb }` — sent only when the poller sees
  events it has not broadcast before.

Two consequences worth knowing about, both driven by the backend's design:

1. **`events` is normally a delta.** `useMatchSocket` accumulates them and
   dedupes by `id`. The exceptions are deliberate: the first broadcast of a
   polling session, and the catch-up message sent to a client that joins a
   match already being tracked, both carry the full event list. Deduping by id
   makes those safe to merge.
2. **State is pushed on connect only if the match is already being polled.**
   The first client to open a match may briefly see "Waiting for match data…"
   until the first poll returns.

## Connection states

`Connecting…` → `Waiting for match data…` → live view → `Match ended`.
`status: "finished"` puts the view into the ended state, and a socket close
after that point is treated as expected rather than as an error. Other closes
retry with exponential backoff (5 attempts) before surfacing an error.

## Layout

Files under `src/`:

- `hooks/useAuth.ts` — Supabase session
- `hooks/useMatchSocket.ts` — socket lifecycle, event accumulation, reconnect
- `components/AuthForm.tsx` — sign in / sign up, with password reveal
- `components/MatchView.tsx` — connection states + layout
- `components/{Scoreboard,WinProbabilityBar,EventFeed}.tsx`

Styling is plain CSS Modules over the design tokens in `src/index.css`; there is
no UI framework.

## Screens

Hash routing, so every screen has a shareable URL and no router dependency.

| Route | Screen |
| --- | --- |
| `#/` | Live matches, filterable, with save toggles |
| `#/match/:id` | Live match view — score, win probability, event feed, save/follow |
| `#/saved` | Saved matches that are currently live (`saved_matches`) |
| `#/following` | Manage followed teams (`followed_teams`) + their live matches |
| `#/archive` | Finished matches (`match_archive`) |
| `#/archive/:id` | Archived match with its full event log |
| `#/profile` | Profile, security and account settings |

## Live FPL point tracking

If you link your Fantasy Premier League team, the match view shows your squad's
live points alongside the feed, and calls out your own players the moment they
are involved.

Two-stage by design:

1. **Instant alert.** When the match poller sees a goal/assist/card, the player
   name is resolved against FPL's player list *locally* (cached data, no network
   call) and, if they are in your squad, an `fpl_alert` goes out immediately —
   "João Pedro scored". It shows "confirming…" because no point value is claimed
   yet.
2. **Confirmed points.** Moments later an `fpl_update` carries the numbers from
   FPL's own `/event/{gw}/live/` endpoint. **No scoring rule is reimplemented** —
   point values are FPL's, multiplied by FPL's own captain/bench multiplier — so
   totals cannot drift from what the FPL app shows.

Both ride the existing per-match websocket; there is no second connection.

### Name matching

Match feeds and FPL name players differently ("B. Saka" vs "Bukayo Saka" vs
"Saka"), so `services/fpl/names.ts` walks a ladder from exact full name down
through web name, surname, initial+surname, token subset, and finally a bounded
edit distance for transliteration differences ("Yarmolyuk" vs "Yarmoliuk").

Two rules keep it honest: candidates are scoped to the two clubs actually in the
match, and **an ambiguous name resolves to nothing rather than a guess** —
crediting a goal to the wrong player is worse than not crediting it. Measured at
66/66 on real Premier League event names.

### Rate-limit discipline

FPL endpoints are unauthenticated but rate-limited, so nothing is fetched
per-user. All three are read through Redis and fanned out:

| Data | Cache | Why |
| --- | --- | --- |
| `bootstrap-static` | 6h | ~1MB master list, changes at most daily |
| `event/{gw}/live` | 45s | shared by every subscriber |
| `entry/{id}/event/{gw}/picks` | 15m | frozen once the deadline passes |

Non-Premier-League matches short-circuit before any FPL call is made.

## Momentum

Alongside `state` and `winProb`, every `update` message carries a `momentum`
field — who is dominating *play*, judged by recent event density rather than the
scoreline:

```json
{ "type": "update", "state": {...}, "winProb": {...},
  "momentum": { "home": 15, "away": 85,
                "raw": { "home": 0.6, "away": 3.6 },
                "eventCount": 2, "windowMinutes": 12 } }
```

`home` and `away` are a 0-100 split that always sums to 100. Events inside a
trailing 12-minute window are weighted by type (goal 4, card 1.5, substitution 1
— **heuristic starting values, not fitted to data**) and decayed exponentially
with a 4-minute half-life, so a goal two minutes ago outweighs one from ten.

Goals and substitutions credit the team that made them. **Cards credit the
opposition**: players get booked when they are under pressure — fouling to stop
a counter, chasing the game — so a run of bookings against one side is evidence
the *other* side is on top, and a red card makes that literal. Crediting a card
to the booked team would read a side being overrun as a side with momentum.
Three bookings against the away team plus one home goal reads `home: 100`, not
`home: 51`.

The point is that it diverges from the score. Observed live: at 60 minutes with
the home side leading 4–2, momentum read `away: 85`, because the away team had
just scored and the home goals were old.

Computed from events the poller already holds — no extra API call. Shots on
target would be a better signal but live on a separate statistics endpoint, and
spending a second request per poll against a 100/day quota was not worth it.

## Post-match summaries

When a match finishes, the server writes a narrative summary built around the
match's actual turning point.

**The turning point is computed, not asked for.** Win probability is sampled once
per match minute into a Redis list (`match:{id}:winprob_series`, same prefix and
TTL as `seen_events`), and at full time the largest swing in home win probability
across any window of up to 5 match minutes is found arithmetically. Asking a
language model to identify the turning point would invite a plausible-sounding
but unfounded answer; the numbers already know. The model is handed the moment
and asked only to narrate it.

A match whose probability never swings more than 8 points has **no** turning
point, and the code says so rather than manufacturing one.

The series lives in Redis while the match is live and is copied into Postgres at
full time, matching the existing split; the Redis key is dropped once archived.

### Summary provider

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `groq`, `gemini`, or unset for none |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | key for the chosen provider |
| `LLM_MODEL` | optional override (defaults: `llama-3.3-70b-versatile`, `gemini-2.0-flash`) |
| `LLM_TIMEOUT_MS` | request timeout, default 20000 |

Both are called over plain `fetch` — no SDK dependency, matching how the project
already calls API-Football. With no provider configured, or if the call fails or
times out, the archive falls back to a templated sentence that still names the
turning point:

> Arsenal beat Chelsea 6–3. The match turned in the 10th minute — Mock goal
> event — swinging it 27 points toward Arsenal.

A summary is a nice touch on an archived match, never a reason to lose the row.

## REST API

All routes require `Authorization: Bearer <supabase access token>`.

```
GET    /matches/live              live fixtures (cached 60s server-side)
GET    /matches/saved             the caller's saved match ids
POST   /matches/:id/save          save        (idempotent)
DELETE /matches/:id/save          unsave
GET    /matches/archive           finished matches, newest first (?team= filter)
GET    /matches/archive/:id       one archived match incl. event_log
GET    /follows                   followed teams
POST   /follows  {teamName}       follow      (idempotent)
DELETE /follows/:teamName         unfollow
GET    /profile                   profile, email, follow/save counts
PATCH  /profile  {username, displayName, bio, avatarUrl, favouriteTeam}
                                  update fields (409 if username taken; returns
                                  `skipped` for anything the schema lacks)
DELETE /profile  {confirm}        delete account; `confirm` must equal the
                                  account's own email address
GET    /fpl/team                  linked FPL entry id
PUT    /fpl/team {teamId}         link (validated against FPL, 404 if no such entry)
DELETE /fpl/team                  unlink
GET    /fpl/squad                 current squad with live points
```

`/matches/live` is cached in Redis for 60s: it is hit on every page load and
each miss costs one upstream request against a 100/day quota.

## Migrations

SQL lives in `db/migrations/`, applied by hand against the Supabase project
(SQL Editor, or psql with `DATABASE_URL`). Every statement is idempotent.

| File | What it does | Status |
| --- | --- | --- |
| `001_profile_fields.sql` | FPL team id, display name, bio, avatar, favourite club, case-insensitive username uniqueness | applied 2026-08-31 |
| `002_authenticated_grants.sql` | Optional: grants that make RLS the enforcing layer again | **not applied** (see below) |
| `003_match_turning_point.sql` | `match_archive.turning_point` jsonb + an index for sorting by most dramatic match | applied 2026-08-31 |

`002` is deliberately left unapplied. It is only half a change: granting the
`authenticated` role DML does nothing on its own while `requireAuth` in
`httpAuth.ts` still uses the service-role client, so it alters the security
posture without yet moving enforcement into the database. Apply it together with
that switch, not before.

The app degrades rather than breaking when a migration is outstanding: the
profile screen shows a banner, extended fields report which values could not be
stored, FPL linking reports no team, and finished matches still archive with the
turning point dropped. Username, follows, saves and the archive keep working
throughout.

## Profile

`#/profile` covers the standard account surface:

- **Identity** — avatar (an image URL, or generated initials), display name,
  unique `@username`, bio, favourite club, member-since, and counts of teams
  followed and matches saved.
- **Security** — change password and change email. A password change
  re-authenticates with the current password first: an open session alone is
  enough for Supabase to accept the change, which would let anyone with a
  borrowed tab lock the owner out.
- **Danger zone** — sign out on all devices (`scope: 'global'`, so other
  browsers are revoked too), and delete account, gated behind typing the
  account's own email address. Deleting the auth user cascades through
  `profiles` to `followed_teams` and `saved_matches`.

Password and email changes go through supabase-js directly; deletion needs the
service-role key and so runs server-side.

Avatars are URLs rather than uploads — no storage bucket to provision, and a URL
that fails to load falls back to initials. Only `http(s)` URLs are accepted, so
a `data:` or `javascript:` URL cannot reach an `img src`.

## Known gaps

- **The `authenticated` role has no DML grant on any table.** RLS policies exist
  ("users manage own …") but can never be reached, because the role lacks
  SELECT/INSERT/UPDATE/DELETE — only `service_role` has them. The backend
  therefore uses the service-role client and scopes every query by `user.id`
  itself, which is safe only because the browser never queries Postgres
  directly. To make the database the enforcing layer again, run:

  ```sql
  grant select, insert, update, delete
    on public.profiles, public.followed_teams, public.saved_matches
    to authenticated;
  grant select on public.match_archive to authenticated, anon;
  ```

  then swap `requireAuth` in `httpAuth.ts` back to a per-request client carrying
  the caller's JWT (the code and rationale are in the comment there).
- **Followed teams are matched by exact name.** `followed_teams.team_name` is
  free text, so "Man City" will not match the feed's "Manchester City". Storing
  the API's numeric team id would fix it, but the column is text.
- **Poll failures are invisible to the client.** If the backend gives up on a
  match (bad key, exhausted quota), it stops broadcasting; the UI keeps showing
  the last known state rather than saying the feed has stopped. Surfacing that
  needs a new websocket message type.
- **Win probability assumes a 90-minute league match** with EPL-average scoring
  rates, so extra time and cup competitions are approximations.
- **The archive only captures matches the server watched to full time.** Nobody
  connected means nobody polling, so the match is never archived — and the
  win-probability series only covers the minutes somebody was watching, so a
  turning point in an unwatched first half cannot be found.
- **Momentum is not persisted.** It is derived from the event log and recomputed
  each poll (the latest value is cached at `match:{id}:momentum` for late
  joiners), so archived matches carry no momentum history.
- **Card attribution is a rule with exceptions.** Cards credit the opposition,
  which is right for the common case (fouling under pressure) but wrong for
  dissent, time-wasting while protecting a lead, and celebration bookings.
- **FPL points refresh only while watching a Premier League match.** Updates are
  pushed on that match's poll cycle, so a squad player scoring in a *different*
  fixture is not reflected until you open that match. A global gameweek poller
  would fix it.
- **Avatars are remote URLs, not uploads.** No image is hosted by the app, so a
  URL that later 404s silently reverts the user to initials.
- **Bonus points move after the whistle.** FPL awards them provisionally during
  a match and finalises them afterwards, so a total can change once more after
  full time. That is FPL's behaviour, faithfully reflected.
