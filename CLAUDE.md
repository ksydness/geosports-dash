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
- **Registration** (`/api/register`) takes a `{ tokens: { site: token } }` map —
  one site is enough; more can be added later from the dashboard's ＋ / connect
  modal (same endpoint, upserts per `group_code+site`). Legacy `{ session_token }`
  still works and is treated as geosports.
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
    cron/sync/route.ts            # GET: daily cron — sync all active groups (full backfill for groups <48h old)
    backfill/[group_code]/route.ts # GET/POST: re-run 30-day backfill (public, 24h throttle via groups.last_backfilled_at; CRON_SECRET bypasses)
lib/
  supabase.ts   # Lazy-initialized Supabase client (Proxy pattern, avoids build errors)
  crypto.ts     # AES-256-GCM encrypt/decrypt for session tokens
  geosports.ts  # GeoSports API client (fetchGroupInfo, fetchDayScores, fetchQuestions, AuthError)
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
- Questions: `GET /api/v2/questions` (public, no auth) — now returns a ~60-day
  archive of rounds (`{rounds: [{date, questions[]}]}`), not just recent days
- 401/403 → token invalid/expired; group gets deactivated

### Global leaderboard (added ~July 2026, not yet used by dashboard)

- `GET /api/leaderboard?date=YYYY-MM-DD&limit=N&offset=N` — public, no auth
- Response: `{date, total, submittedTotal, hasMore, entries: [{rank, username, score}], you, averageScore}`
  - `total` varies per date (~48–78k) — appears to be users who started that
    day's round, NOT global registered count; `submittedTotal` = plays that day
  - `averageScore` = global average for the day (e.g. 802)
  - `you` = caller's own entry when a session cookie is sent, else null
  - Paginate with `offset` + `hasMore`
- **Historical dates now work (verified 2026-07-11)**: full data (entries +
  `averageScore`) is served for any date from **2026-06-27** onward; earlier
  dates return empty (`total: 0`). No snapshot cron needed for ≥2026-06-27;
  pre-cutoff global data is unrecoverable. Also live on geohistory.gg and
  geofooty.app.
- `POST /api/leaderboard/submit` — client submits the day's result to the
  global board (dashboard never needs this).

### Authed endpoints (verified with live session, July 2026)

All take `Cookie: __Secure-geosports.session_token=<token>` and return the
**token owner's** data only:

- `GET /api/auth/get-session` — `{session: {userId, expiresAt, ...}, user: {id, name, email, ...}}`.
  **Sliding expiry, verified July 2026**: calling get-session pushes `expiresAt`
  to now+30d, so the daily sync keeps stored tokens alive indefinitely. Tokens
  only die if syncs stop for 30 days or the user logs out. Each sync stores the
  reported expiry in `group_sites.expires_at`.
- `GET /api/me/history?from=YYYY-MM-DD&to=YYYY-MM-DD` — `{from, to, entries: [{date, score}]}`.
  Defaults to last 30 days; explicit `from`/`to` returns full history back to
  account creation. Daily totals only, no per-question data.
- `GET /api/results/daily?date=YYYY-MM-DD` — own result with **exact guess
  coordinates**: `{resultId, totalScore, source, username, completedAt,
  guesses: [{questionId, questionIndex, guessLat, guessLng, distanceMiles,
  rawScore, multiplier, score, answer: {lat, lng, name, story}}]}`. Session-scoped
  only — user params are ignored, so other group members' pins are NOT obtainable.
- Leaderboard `you` caveat (re-verified 2026-07-11): `you` is **null even when
  authed and played** (today and past dates). Likely explanation: the global
  board is opt-in via `POST /api/leaderboard/submit` — `submittedTotal` (~9k)
  ≪ `total` (~48k), so `entries`/`you` only cover users who submitted. Don't
  build global-rank features on `you`.

### Pro (added ~July 2026)

- `GET /api/pro/entitlement` — authed; `{authenticated, email, isPro, planInterval}`.
  Works as a cheap session-token health check. Unauthed → 200
  `{authenticated: false, isPro: false}` (no email field).
- `GET /api/pro/leaderboard` — `{"error": "Not a Pro subscriber"}` for free users
- `GET /api/pro/state?date=YYYY-MM-DD` — **Pro-gated**: 401 unauthed, 403
  `{"error":"Not a Pro subscriber"}` for authed free users
- Pro tier gates: previous days, random rounds, sport-specific rounds
  (General/NBA/NFL/MLB), pro leaderboard
- Stripe billing routes: `POST /api/stripe/checkout|portal|cancel`,
  `GET /api/stripe/status` (all authed)

### Other endpoints found in client bundles (2026-07-11; GETs verified authed via Kenny's Chrome session)

Discovered by mining `_next` JS chunks on geosports.app; all authed
(401 `{"error":"Not authenticated"}` without a cookie):

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
- Page routes (from embedded route manifest): `/me`, `/embed/globe`, `/play`,
  `/results`, `/groups`, `/groups/join`, `/leaderboard`, `/login`,
  `/how-it-works`, `/pro/*`
- Ignore `/api/early_access_features`, `/api/surveys`, `/api/product_tours`,
  `/api/web_experiments` in bundles — those are PostHog, not GeoSports.

## Dashboard Tabs

The dashboard (`app/g/[group_code]/dashboard.tsx`) has 5 tabs:
1. **Today** — per-question bar charts + group average
2. **Week** — day-by-day score list
3. **Month** — question averages for current month
4. **All Time** — question averages across all history
5. **Stats** — records (best/worst day) + head-to-head comparison. Day/week/month "wins" require ≥2 participants in that period — solo play never counts as a win.
