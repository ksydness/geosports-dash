# geosports-dash

A multi-tenant SaaS dashboard for GeoSports groups. Any GeoSports group can register with their group code + session token and get a shareable, auto-syncing leaderboard URL.

## Key URLs

- **Production**: https://geosports-dash.vercel.app
- **GitHub**: https://github.com/ksydness/geosports-dash
- **Vercel project ID**: prj_gmqRYxDb3PX0bMUrm7H5kBR2ZBWl
- **Vercel team**: ksyd-projects (team_ehXYoYTnX36nTlQX4GkRIbwA)

## Stack

- **Framework**: Next.js 15 (App Router) on Vercel Hobby plan
- **Database**: Supabase (Postgres)
- **Auth**: GeoSports session token (AES-256-GCM encrypted at rest)
- **Deployment**: Vercel auto-deploys on push to `main`

## Deployment Workflow

Claude can push code changes directly — no terminal needed:
1. Edit files in `/tmp/geosports-push/` (or clone fresh from GitHub)
2. Commit and push to `https://github.com/ksydness/geosports-dash`
3. Vercel auto-deploys within ~1 minute

```bash
cd /tmp/geosports-push
git add -A && git commit -m "description" && git push
```

Token format: classic PAT with `repo` scope. Kenny provides when needed.

## Environment Variables (set in Vercel dashboard)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM token encryption |
| `CRON_SECRET` | Bearer token protecting `/api/cron/sync` |

## Database Schema (Supabase)

```sql
CREATE TABLE groups (                  -- one row per group code (shared identity)
  group_code TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  session_token TEXT,            -- LEGACY geosports token mirror; nullable. Per-site
                                 -- tokens now live in group_sites. Kept for /api/results.
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  last_backfilled_at TIMESTAMPTZ
);

CREATE TABLE group_sites (             -- one row per (group, connected game)
  group_code TEXT NOT NULL REFERENCES groups(group_code) ON DELETE CASCADE,
  site TEXT NOT NULL,                  -- 'geosports' | 'geohistory' | 'geofooty'
  session_token TEXT NOT NULL,         -- AES-256-GCM encrypted, per site
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  last_backfilled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,               -- token expiry from /api/auth/get-session, refreshed each sync
  PRIMARY KEY (group_code, site)
);

CREATE TABLE scores (
  group_code TEXT NOT NULL REFERENCES groups(group_code) ON DELETE CASCADE,
  site TEXT NOT NULL DEFAULT 'geosports',
  date DATE NOT NULL,
  user_id TEXT NOT NULL,        -- stable UUID, SHARED across all three games
  username TEXT NOT NULL,       -- mutable display label (latest write wins)
  score INTEGER NOT NULL,
  raw_scores JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_code, site, date, user_id)
);

CREATE TABLE score_overrides (      -- manual corrections (e.g. GeoSports answer-key errors)
  group_code TEXT NOT NULL REFERENCES groups(group_code) ON DELETE CASCADE,
  site TEXT NOT NULL DEFAULT 'geosports',
  date DATE NOT NULL,
  user_id TEXT NOT NULL,   -- same key shape as scores (group_code, site, date, user_id)
  raw_scores JSONB,        -- corrected per-question raw array
  score INTEGER NOT NULL,  -- corrected daily total
  reason TEXT,             -- why the override was applied (audit note)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_code, site, date, user_id)
);

CREATE TABLE answers (
  date DATE PRIMARY KEY,
  guesses JSONB NOT NULL,  -- cached daily answer key from GeoSports guess endpoint
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

All five tables have RLS enabled (no policies) — the app reaches the DB only via
the Supabase service role key, which bypasses RLS, so anon/public access is
blocked. `score_overrides` had RLS enabled 2026-07-14 to close a Supabase
security advisor (`rls_disabled_in_public`).

## Multi-site (GeoSports + GeoHistory + GeoFooty)

GeoHistory (geohistory.gg) and GeoFooty (geofooty.app) are the same backend as
GeoSports: identical API shape (`/api/groups/{code}`, `/api/v2/questions`,
`/api/auth/get-session`), the SAME group codes, and the SAME `userId`s. Only the
domain + session cookie differ per site. `lib/sites.ts` is the registry (base URL,
cookie name candidates, label/accent/emoji).

- **Auth is per-site**: each domain sets its own session cookie. `lib/geosports.ts`
  `siteFetch()` tries each candidate cookie name (`__Secure-<site>.session_token`,
  falling back to the geosports prefix) and memoises the one that authenticates,
  so a wrong prefix self-corrects instead of being mistaken for an expired token.
- **…but raw tokens are cross-site (verified 2026-07-31)**: the three domains
  share ONE server-side session store, so a RAW session token from any game
  authenticates on all three via `Authorization: Bearer`. The domain decides
  the game context (verified: geosports token on geohistory.gg returned the
  correct geohistory scores + `gameId: "geohistory"` from /api/streak). BROWSER
  sessions stay per-domain (cookies don't travel), so users can still be logged
  into one game and not another. Consequence: cross-pasting a key into the
  wrong game's box connects fine, and one key COULD connect all three games.
  This looks like an accident of the shared backend — if GeoSports ever locks
  tokens to their origin site, cross-connected sites will start 401ing, sync's
  AuthError handling deactivates them, and users see the reconnect banner
  (graceful). Don't build anything that depends on cross-site tokens staying
  valid.
- **Registration** (`/api/register`) takes a `{ tokens: { site: token } }` map —
  one site is enough; more can be added later from the dashboard's ＋ / connect
  modal (same endpoint, upserts per `group_code+site`). Legacy `{ session_token }`
  still works and is treated as geosports.
- **Key-page connect flow (2026-07-31)**: users open
  `https://<site>/api/auth/get-session` ("key page") while logged in, copy the
  whole JSON, and paste it into the registration page or connect modal — no
  DevTools, works on mobile. `lib/token-paste.ts` parses the paste CLIENT-SIDE
  (email/IP in the blob never reach our server; only `session.token` does) and
  also accepts raw tokens and legacy cookie values. `siteFetch` sends raw
  tokens as `Authorization: Bearer` (better-auth bearer plugin) and cookie
  values via the cookie-candidate path. `POST /api/token/groups {site, token}`
  validates a key and returns the member's groups (from the site's
  `GET /api/groups`) to power the registration group picker.
- **One key, opt-in games (2026-07-31, later)**: because raw tokens are
  cross-site, registration asks for ONE key and offers checkboxes for which
  games to track (same token stored per selected site; only geosports is
  pre-ticked — connecting a game nobody plays would empty Sicko Mode boards).
  On existing dashboards, `POST /api/sites/connect {group_code, site}` connects
  or reconnects a game with NO new key: it revalidates a stored donor token
  (active rows first, geosports preferred) against the target site and saves
  it, then backfills. The ＋ modal offers "⚡ connect instantly" first and only
  falls back to the key-page paste flow when the server answers
  `needsKey: true` (which is what will happen if GeoSports ever locks tokens
  to their origin site — the flow degrades gracefully by design). Note this
  means anyone with the dashboard URL can connect/heal games using the stored
  key; acceptable because it only ever exposes the same group's scores.
- **Dashboard**: a site switcher sits above the 5 tabs. Selecting a site filters
  the score array to that site; **Sicko Mode** (shown when ≥2 sites connected)
  sums each player's daily score across sites by `user_id` (totals only — raw
  per-question scores aren't comparable across games). Maps / answer-key / practice
  game are GeoSports-only and gated to that view.

## Project Structure

```
app/
  page.tsx                        # Registration page (group code + session token form)
  layout.tsx                      # Root layout
  globals.css                     # Global styles
  g/[group_code]/
    page.tsx                      # Server component — passes group_code to dashboard
    dashboard.tsx                 # Client component — full dashboard UI (all tabs)
  g/demo/
    page.tsx                      # Public demo dashboard (uses lib/demo-data, no real group)
  api/
    register/route.ts             # POST: register a group, kick off 30-day backfill
    scores/[group_code]/route.ts  # GET: return scores + auto-sync if stale >10min
    questions/route.ts            # GET: proxy GeoSports public questions endpoint
    token/groups/route.ts         # POST: validate a session key, list the member's groups (connect flow)
    sites/connect/route.ts        # POST: one-click connect/reconnect a game reusing a stored donor key
    cron/sync/route.ts            # GET: daily cron — sync all active groups (full backfill for groups <48h old)
    backfill/[group_code]/route.ts # GET/POST: re-run 30-day backfill (public, 24h throttle via groups.last_backfilled_at; CRON_SECRET bypasses)
lib/
  supabase.ts   # Lazy-initialized Supabase client (Proxy pattern, avoids build errors)
  crypto.ts     # AES-256-GCM encrypt/decrypt for session tokens
  geosports.ts  # GeoSports API client (fetchGroupInfo, fetchDayScores, fetchMyGroups, fetchQuestions, AuthError); siteFetch tries Bearer + cookie transports
  token-paste.ts # Client-side key-page/raw/cookie paste parsing (parseTokenPaste, keyPageUrl)
  sync.ts       # Shared sync logic (syncGroup, upsertDayScores) — deactivates group on AuthError
  dates.ts      # Eastern-time date helpers (todayET, etDateMinusDays)
  scoring.ts    # Local replica of GeoSports' distance→points curve (haversineMiles, milesToRawScore, scoreTier, greatCirclePoints, MULTIPLIERS) — powers the easter-egg practice game without calling the live API
  demo-data.ts  # Deterministic mock scores (generateDemoData, DEMO_GROUP_NAME) for the /g/demo dashboard
```

## Key Architecture Decisions

- **Score overrides**: `score_overrides` rows are merged into `/api/scores` responses at read time (replacing `score`/`raw_scores`, adding `corrected: true`). Syncs keep writing GeoSports' values to `scores`, so corrections are never clobbered. Rows are inserted manually (via Claude/SQL) after verifying a player was scored against a wrong answer key.
- **Stale-while-revalidate sync**: `/api/scores` triggers a background sync via `waitUntil()` if `last_synced_at` > 3 minutes ago. Compensates for Vercel Hobby's single daily cron limit.
- **Live sync on Refresh**: `/api/scores/{code}?sync=1` (used by the dashboard Refresh button) awaits a GeoSports sync *before* responding, so a fresh play appears in one refresh.
- **Lazy Supabase client**: Proxy pattern avoids `supabaseUrl is required` errors at Next.js build time.
- **Browser-like headers**: GeoSports API calls include `User-Agent`, `Referer`, `Origin` to avoid 401s.
- **`.npmrc` with `legacy-peer-deps=true`**: Required for Vercel to resolve Next.js 15 / React 19 peer dep conflict.
- **Cron**: Single daily cron at `0 6 * * *` registered in `vercel.json`. Groups registered <48h ago get a full 30-day backfill pass instead of a daily sync, to repair holes from the registration backfill.
- **Backfill robustness**: `backfillGroup` (lib/sync.ts) retries each day once on transient GeoSports failure and paces requests at 400ms. Routes that run it need `export const maxDuration = 60` — Vercel's 10s default kills it mid-run (this caused sparse history for early groups).
- **Eastern time**: The game rolls over at midnight ET, so all "today" date math (server and client) uses `America/New_York` via `lib/dates.ts`. Syncs cover today + yesterday (ET) to catch plays made after the previous day's last sync.
- **Answer key cache**: `/api/answers` serves from the Supabase `answers` table when populated; otherwise fetches from GeoSports' guess endpoint and caches. Past dates are immutable (long `Cache-Control`).
- **Escaping**: dashboard.tsx renders via innerHTML — all untrusted strings (usernames, prompts, answer names/stories) must go through `esc()`, and inline handler args through `attrJs()`.

## GeoSports API

- Base: `https://geosports.app`
- Auth: `Cookie: __Secure-geosports.session_token=<token>`
- Group endpoint: `GET /api/groups/{group_code}?date=YYYY-MM-DD`
- Questions: `GET /api/v2/questions` (public, no auth) — archive of rounds,
  `{rounds: [{date, questions: [{id, prompt, map, difficulty}]}]}`. Re-verified
  2026-07-31: **89 rounds, 2026-05-04 → today**, 5 questions per round.
  `difficulty` is new since the last scan but is `"medium"` on all 445 questions
  — a placeholder, don't branch on it. `id` is `YYYY-MM-DD-qN`, `map` is `world`.
- 401/403 → token invalid/expired; group gets deactivated
- Group endpoint shape unchanged (2026-07-31): `{group: {id, name, code,
  memberCount}, leaderboard: [{userId, username, role, score, rawScores}],
  currentUserId}`

### Global leaderboard (added ~July 2026, not yet used by dashboard)

- `GET /api/leaderboard?date=YYYY-MM-DD&limit=N&offset=N` — public, no auth
- Response: `{date, total, submittedTotal, hasMore, entries: [{rank, username, score}], you, averageScore}`
  - `total` varies per date (~48–78k) — appears to be users who started that
    day's round, NOT global registered count; `submittedTotal` = plays that day
  - `averageScore` = global average for the day (e.g. 802)
  - `you` = caller's own entry when a session cookie is sent, else null
  - Paginate with `offset` + `hasMore`
- **REGRESSION — history is now a 14-day rolling window (verified 2026-07-31)**:
  the old behaviour (any date from 2026-06-27 onward) is gone. Boundary probed
  on 2026-07-31: `2026-07-17` returns full data, `2026-07-16` and everything
  earlier returns `{total: 0, submittedTotal: 0, averageScore: null, entries: []}`
  — i.e. **today − 14 days**. Dates that worked in the 2026-07-11 scan
  (2026-06-27 … 2026-07-16) no longer do, so this is a server-side retention
  change, not a backfill gap. Consequence: **global data older than 14 days is
  permanently unrecoverable**, and a daily snapshot cron is now required if the
  dashboard ever wants long-run "vs. the world" comparisons. Sample values on
  2026-07-31: total 43878 / submitted 10244 / avg 783 (today, still filling);
  2026-07-29: 66378 / 14521 / 837.
- `POST /api/leaderboard/submit` — client submits the day's result to the
  global board (dashboard never needs this).

### Streaks (NEW — discovered 2026-07-31)

- `GET /api/streak` — no params (a `?gameId=` query is ignored; the game is
  inferred from the domain). Authed response:
  `{enabled: true, gameId: "geosports", currentStreak, longestStreak,
  lastPlayedDate, streakStartedDate, isMilestone, visualTier, quip,
  week: [{date, state}]}` where `state` ∈ `missed | played | today | future`
  and `week` spans the current Sun–Sat window (includes future days).
  `visualTier` (`"default"`) and `quip` (`"WARMING UP"`) look like presentation
  hooks tied to streak length / `isMilestone`.
- **Unauthed it returns 200 `{enabled: false, gameId: "geosports"}`, not 401** —
  so it is useless as a session-health check (use `/api/pro/entitlement` for
  that, which does report `authenticated`).
- Also live on geohistory.gg (`gameId: "geohistory"`), so `gameId` is per-domain.
- Session-scoped like everything else: no way to get other members' streaks, so
  a group streak leaderboard would have to be computed from our own `scores`
  table rather than fetched.

### Authed endpoints (verified with live session, July 2026; re-verified 2026-07-31)

All take `Cookie: __Secure-geosports.session_token=<token>` and return the
**token owner's** data only:

- `GET /api/auth/get-session` — `{session: {userId, expiresAt, ...}, user: {id, name, email, ...}}`.
  **Sliding expiry, verified July 2026**: calling get-session pushes `expiresAt`
  to now+30d, so the daily sync keeps stored tokens alive indefinitely. Tokens
  only die if syncs stop for 30 days or the user logs out. Each sync stores the
  reported expiry in `group_sites.expires_at`.
- `GET /api/auth/token` (NEW — found 2026-07-31) — better-auth JWT plugin. Mints
  a **15-minute** EdDSA JWT (`{token}`; claims `sub/email/iat/exp/iss/aud`) for
  the session-cookie owner; 401 without the cookie. JWKS at `/api/auth/jwks`.
  `Authorization: Bearer <jwt>` authenticates API calls without a cookie
  (verified on `/api/me/history` and the group endpoint). **Not an alternative
  connection method**: minting requires an existing session cookie and the JWT
  dies in 15 min, so registration still needs the pasted session token. No API
  keys / OAuth / share-link endpoints exist (`/api/auth/api-key`, `/api/keys`,
  `/api/groups/{code}/share`, etc. all 404; group endpoint still 401 unauthed —
  all probed 2026-07-31). **CORS: geosports.app sends no
  `Access-Control-Allow-Origin` at all** (probed 2026-07-31 from
  geosports-dash.vercel.app: Bearer requests, public `v2/questions` +
  `leaderboard`, and the JWT mint are ALL browser-blocked cross-origin). So no
  client-side calls to GeoSports ever — everything must proxy through our API
  routes, JWTs included. Server-side Bearer use still works fine.
- `GET /api/me/history?from=YYYY-MM-DD&to=YYYY-MM-DD` — `{from, to, entries: [{date, score}]}`.
  Defaults to last 30 days; explicit `from`/`to` returns full history back to
  account creation. Daily totals only, no per-question data.
- `GET /api/results/daily?date=YYYY-MM-DD` — own result with **exact guess
  coordinates**: `{resultId, date, totalScore, source, username, completedAt,
  guesses: [{questionId, questionIndex, guessLat, guessLng, distanceMiles,
  rawScore, multiplier, score, answer: {lat, lng, name, story}}]}`. Session-scoped
  only — user params are ignored, so other group members' pins are NOT obtainable.
  A `date` field is now echoed at the top level. A date the caller didn't play
  returns **404 `{"error":"not found"}`** (no auth error), so callers must handle
  404 as "no result", not as a bad token.
- Leaderboard `you` caveat (re-verified 2026-07-31): `you` is still **null even
  when authed and played** (today and past dates). Likely explanation: the global
  board is opt-in via `POST /api/leaderboard/submit` — `submittedTotal` (~10–15k)
  ≪ `total` (~44–70k), so `entries`/`you` only cover users who submitted. Don't
  build global-rank features on `you`.

### Pro (added ~July 2026)

- `GET /api/pro/entitlement` — authed; `{authenticated, email, isPro, planInterval}`.
  Works as a cheap session-token health check. Unauthed → 200
  `{authenticated: false, isPro: false}` (no email field).
- `GET /api/pro/leaderboard` — 403 `{"error": "Not a Pro subscriber"}` for free users
- `GET /api/pro/state?date=YYYY-MM-DD` — **Pro-gated**: 401 unauthed, 403
  `{"error":"Not a Pro subscriber"}` for authed free users
- Pro tier gates: previous days, random rounds, sport-specific rounds
  (General/NBA/NFL/MLB), pro leaderboard
- Stripe billing routes: `POST /api/stripe/checkout|portal|cancel`,
  `GET /api/stripe/status` (all authed)

#### Pro gameplay routes (NEW — found in `/pro/*` subpage chunks, 2026-07-31 second pass)

These live only in the chunks loaded by the Pro subpages (`/pro/leaderboard`,
`/pro/play`, `/pro/results`, `/pro/previous-days`, `/pro/random{,/play,/results,/summary}`,
`/pro/sport-specific`), which earlier scans never crawled — that's why they were
missed. All four are **Pro-gated** (403 `{"error":"Not a Pro subscriber"}` on
Kenny's free account, so response shapes are unverified):

- `GET /api/pro/questions` — presumably the Pro question feed (previous days /
  sport-specific). Query params unconfirmed: `?date=` and `?sport=` both still
  403 before validation, and the bundle code didn't reveal them.
- `GET /api/pro/random-round?exclude=…` — fetch a random round; `exclude` seen
  in bundle code (likely already-played round ids).
- `POST /api/pro/random-guess {roundId, questionId, questionIndex, guess}` —
  guess endpoint for random rounds (405 on GET).
- `POST /api/results/commit-pro-random {roundId}` — persists a finished random
  round (405 on GET).

Not useful to the dashboard unless Kenny goes Pro; if a Pro token ever gets
stored, `/api/pro/questions` may be an answer-key source for pre-2026-05-04
rounds. Re-probe shapes then.

### Other endpoints found in client bundles (rescanned 2026-07-31 via Kenny's Chrome session)

Discovered by mining `_next` JS chunks on geosports.app; all authed
(401 `{"error":"Not authenticated"}` without a cookie):

**Full route inventory as of the 2026-07-31 second-pass rescan** (main pages:
26 chunks across `/`, `/me`, `/groups`, `/groups/join`, `/leaderboard`, `/pro`,
`/play`, `/results`, `/login`, `/how-it-works`, `/embed/globe`, `/pro/success`;
plus 23 chunks across the 9 `/pro/*` subpages, which earlier scans missed):
`/api/auth/*`, `/api/groups`, `/api/groups/{code}`, `/api/groups/{code}/nickname`,
`/api/groups/join`, `/api/leaderboard`, `/api/leaderboard/submit`,
`/api/me/history`, `/api/me/preferences`, `/api/play/complete`,
`/api/pro/entitlement`, `/api/pro/leaderboard`, `/api/pro/questions`,
`/api/pro/random-guess`, `/api/pro/random-round`, `/api/pro/state`,
`/api/results/commit-daily`, `/api/results/commit-pro-random`,
`/api/results/daily`, `/api/streak`, `/api/stripe/{checkout,portal,cancel,status}`,
`/api/v2/play/guess`, `/api/v2/questions`. The four Pro gameplay routes
(`pro/questions`, `pro/random-round`, `pro/random-guess`,
`results/commit-pro-random`) are the additions this pass — see the Pro section.
~23 plausible guesses (`/api/me/stats`, `/api/achievements`, `/api/friends`,
`/api/leaderboard/friends`, `/api/pro/history`, `/api/v3/questions`, …) all 404,
so the bundle inventory appears complete. `/stats`, `/settings`, `/archive`,
`/friends` and `/achievements` are not page routes (404); `/pro/success` is.

- `GET /api/groups` — caller's groups: `{groups: [{id, name, code, role,
  memberCount, createdAt}]}`; `POST /api/groups {name}` — create a group;
  `POST /api/groups/join {code}` — join
- `POST /api/groups/{code}/nickname {nickname}` — **per-group display names**.
  Usernames in the group endpoint can now differ per group and change anytime —
  reinforces that scores must be keyed on `user_id`, never `username`.
- `GET/PUT /api/me/preferences` — `{confirmToLock: bool}`
- `GET /api/stripe/status` — `{active: bool}`
- `POST /api/v2/play/guess {date, questionIndex, guess, clientId}` — the guess
  endpoint (source of the answer-key cache)
- `POST /api/play/complete {date, clientId, ...}` and
  `POST /api/results/commit-daily` — round completion / result persistence
- `GET /api/streak` — see the Streaks section above
- Page routes (from embedded route manifest): `/me`, `/embed/globe`, `/play`,
  `/results`, `/groups`, `/groups/join`, `/leaderboard`, `/login`,
  `/how-it-works`, and under `/pro`: `/pro/success`, `/pro/leaderboard`,
  `/pro/play`, `/pro/results`, `/pro/previous-days`, `/pro/random`,
  `/pro/random/play`, `/pro/random/results`, `/pro/random/summary`,
  `/pro/sport-specific`
- Ignore `/api/early_access_features`, `/api/surveys`, `/api/product_tours`,
  `/api/web_experiments` in bundles — those are PostHog, not GeoSports.

## Dashboard Tabs

The dashboard (`app/g/[group_code]/dashboard.tsx`) has 5 tabs:
1. **Today** — per-question bar charts + group average
2. **Week** — day-by-day score list
3. **Month** — question averages for current month
4. **All Time** — question averages across all history
5. **Stats** — records (best/worst day) + head-to-head comparison. Day/week/month "wins" require ≥2 participants in that period — solo play never counts as a win.
