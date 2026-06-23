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

CREATE TABLE answers (
  date DATE PRIMARY KEY,
  guesses JSONB NOT NULL,  -- cached daily answer key from GeoSports guess endpoint
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

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
- Questions: `GET /api/v2/questions` (public, no auth)
- 401/403 → token invalid/expired; group gets deactivated

## Dashboard Tabs

The dashboard (`app/g/[group_code]/dashboard.tsx`) has 5 tabs:
1. **Today** — per-question bar charts + group average
2. **Week** — day-by-day score list
3. **Month** — question averages for current month
4. **All Time** — question averages across all history
5. **Stats** — records (best/worst day) + head-to-head comparison. Day/week/month "wins" require ≥2 participants in that period — solo play never counts as a win.
