# FootyCompanion — frontend

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
| `VITE_MATCH_ID`          | Match to render. Defaults to `test789`.              |

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

## Known gaps

- **No match selection.** `VITE_MATCH_ID` is a single hardcoded fixture. Real
  fixture ids change every day, so this needs a picker (a `/fixtures?live=all`
  proxy on the backend plus a list screen) before the app is usable by anyone
  who is not editing `.env`.
- **Poll failures are invisible to the client.** If the backend gives up on a
  match (bad key, exhausted quota), it stops broadcasting; the UI keeps showing
  the last known state rather than saying the feed has stopped. Surfacing that
  needs a new websocket message type.
- **Win probability assumes a 90-minute league match** with EPL-average scoring
  rates, so extra time and cup competitions are approximations.
