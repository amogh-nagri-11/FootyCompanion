LiveXI
======

A live football second screen: scores and events as they happen, win
probability, momentum, your FPL squad reconciled against the match, and — once
a match is over — statistics, lineups, player ratings, a narrated recap and a
chat you can ask about it.

    frontend/                     React + Vite client
    match-second-screen-backend/  Fastify API, websocket feed, match poller
    db/migrations/                SQL, applied by hand in order

Running it
----------

    cd match-second-screen-backend && npm install && npm run dev   # :4000
    cd frontend && npm install && npm run dev                      # :5173

Both need a `.env` (see `.env.example` in each). The backend additionally wants
Redis; without it everything still works, just slower and against a smaller
effective request budget.

    npm test              # unit suite, offline and deterministic (both projects)
    npm run eval:llm      # grounding + injection evaluation, calls a live model
    npm run backfill:team-ids

Migrations are applied in numeric order against `DATABASE_URL`:

    psql "$DATABASE_URL" -f db/migrations/00N_name.sql

Where the constraints are
-------------------------

**The upstream request budget is the design constraint.** The free
API-Football plan allows 100 requests a day and serves only yesterday, today
and tomorrow. Every upstream call takes a ticket from one shared daily counter
(`services/apiQuota.ts`), split so that browsing can never starve live polling:
interactive requests stop at 70% of the budget, polling may spend to the end.
Poll cadence is derived from how many matches are actually being watched, so N
concurrent matches divide the budget rather than multiplying the spend.

Caching is therefore load-bearing, not an optimisation. Finished matches and
past dates cannot change, so they are held for a day; live data for 60–120s;
match statistics are fetched only when someone opens a match, never from the
poll loop.

**Access control is enforced by Postgres.** `req.db` carries the caller's JWT,
so RLS policies decide what each query returns and a forgotten `.eq('user_id',
…)` returns nothing rather than another user's rows. This requires
`002_authenticated_grants.sql`; without it the `authenticated` role has no DML
and every query fails before RLS is consulted. The service-role client is now
only used for work with no caller behind it (the poller archiving a match).

What is honest about the AI parts
---------------------------------

Three features use a model, and it is worth being precise about which parts do
and do not.

**Post-match summaries.** The turning point is *computed*, deterministically,
from the win-probability series — the model is never asked which moment
mattered. It only narrates a fact it was handed. There is a deterministic
templated summary behind it, used whenever generation fails or no provider is
configured; `npm run eval:llm` reports how often that fallback actually
triggers, which was previously unknown.

**Match chat.** Grounded in one match's own recorded data. The match data is
supplied in the *system* message and the reader's words stay in *user*
messages, so the two occupy different roles; questions are additionally fenced
with a per-request nonce, and text imitating the framing is neutralised. This
closes a real hole — data and question previously shared one role, so a pasted
"DATA" block arrived with the same standing as the real one. Injection cases
are exercised by the eval suite.

**Player and team name matching is not AI.** `fpl/names.ts` and
`teamDirectory.ts` are deterministic string rules — normalise, exact, surname,
bounded edit distance. "Fuzzy" there means tolerant of spelling, not learned.
Nothing is trained and the same input always gives the same output.

What is still missing
---------------------

- **Heatmaps and positional data.** Not available from API-Football on any
  plan — there are no coordinates to draw. Would need a different provider.
- **Summary quality is unmeasured.** The eval suite checks grounding
  (contradictions, invented citations, truncation, drift to players who were
  not there) and injection resistance. It cannot tell you whether the prose is
  any good; that still needs a human read.
- **Chat answers are not streamed**, so there is a short wait behind an
  indicator. Answers are cached for a day per exact thread.
- **No load testing and no deployment.** Nothing here has faced real traffic,
  so the quota arithmetic above is reasoned rather than observed.
- **Substitution direction upstream is unreliable** — a player with 14 minutes
  can appear coming off at 68'. Rather than guess a correction, the chat
  cross-checks direction against minutes played and reports the record as
  inconsistent.
- **Duels and some player fields are sparse** on the free tier and render as
  "—" rather than zero.
- **Tests cover pure logic only.** No component rendering, no HTTP-level
  integration tests, no test against a live feed.
