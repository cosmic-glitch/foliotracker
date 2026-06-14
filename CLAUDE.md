# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep this file in sync.** After any change that adds, removes, or meaningfully alters a file path, table, endpoint, hook, env var, workflow, or architectural pattern, reassess whether `CLAUDE.md` still accurately describes the codebase and update it in the same commit. Don't wait to be asked — out-of-date guidance silently misleads future work.

## Project Overview

FolioTracker is a multi-portfolio stock tracker built with React + Vite frontend and Vercel serverless API backend. It displays real-time portfolio values with holdings breakdown by type.

**Live URL:** https://foliotracker.vercel.app

## Commands

```bash
npm run dev      # Start Vite dev server (frontend only, API requires deployment)
npm run build    # TypeScript compile + Vite production build
npm run lint     # ESLint
npm run preview  # Preview production build locally

vercel           # Deploy to preview
vercel --prod    # Deploy to production
```

## Architecture

### Frontend (React + Vite + Tailwind)
- `src/main.tsx` - Router (`/`, `/create`, `/:portfolioId`, `/:portfolioId/edit`, `/analytics`) wrapped in the React Query `QueryClientProvider` and the context providers below
- `src/App.tsx` - Main portfolio view page
- `src/pages/` - LandingPage, CreatePortfolio, EditPortfolio, AnalyticsDashboard
- `src/components/` - UI components (HoldingsTable, HoldingsByType, TotalValue, MoversStrip, UpcomingEvents, NewsSection/NewsTicker, AIResearchSection, etc.)
- `src/context/` - Context providers: `ThemeContext` (dark/light), `ExtendedHoursContext` (regular vs extended-hours price basis), `TimeframeContext` (`day`/`30d` chart range), `ToastContext` (transient toasts)
- `src/lib/` - Frontend helpers: `queryClient.ts` (React Query config), `supabase.ts`, `auth.ts`, `market-hours.ts`, `parseHoldingsCsv.ts` (CSV holdings import), `newsHeadline.ts`, `mockData.ts`
- `src/utils/` - `formatters.ts`, `equivalentTickers.ts` (GOOG/GOOGL consolidation for display)
- **Data fetching is React Query** (`@tanstack/react-query`); the data hooks wrap `useQuery` against the API:
  - `src/hooks/usePortfolioData.ts` - Portfolio data for a route
  - `src/hooks/usePortfolioNews.ts` - Per-ticker news from `GET /api/news`
  - `src/hooks/useUpcomingEvents.ts` - Landing-page upcoming events from `GET /api/events`
- `src/hooks/useLoggedInPortfolio.ts` - Portfolio login state (localStorage, synchronous hydration)
- `src/hooks/useUnlockedPortfolios.ts` - Portfolios unlocked this tab (sessionStorage, synchronous hydration)
- `src/hooks/useHoldingsCsvUpload.ts` - CSV holdings import flow (Create/Edit portfolio)
- `src/hooks/usePeakReveal.ts` - Count-up/hold animation for the headline total value
- `src/hooks/useAnalytics.ts` - `useViewAnalytics` (portfolio routes) and `useLandingViewAnalytics` (landing page) fire `POST /api/log-view` on mount and on tab visibility change
- `src/types/portfolio.ts` - TypeScript interfaces for Holding, PortfolioData

### Backend (Vercel Serverless Functions)
- `api/portfolio.ts` - GET single portfolio (Redis → snapshot fallback)
- `api/portfolios.ts` - CRUD for portfolios (GET list, POST create, PUT update, DELETE); also serves the analytics dashboard data and computes the landing-page market movers (`movers` field on the GET list response — `{ regular, extended }`, one ranked list per price basis)
- `api/history.ts` - Historical price data (Redis → snapshot fallback)
- `api/news.ts` - `GET /api/news?tickers=…` returns per-ticker news: AI summaries from `ticker_news_summaries` when fresh, else a Yahoo-article fallback
- `api/events.ts` - `GET /api/events` returns the landing-page Upcoming Events feed (future-dated rows from `upcoming_events`, ranked)
- `api/refresh-prices.ts` - Background endpoint to refresh all portfolio snapshots
- `api/login.ts` - Password verification + session token issuance. Emits the `login` analytics event.
- `api/log-view.ts` - Emits `view` analytics events. Missing `portfolio_id` means a landing-page view (recorded with `portfolio_id = null`).
- `api/permissions.ts` - Portfolio viewer permissions (selective visibility)
- `api/share-links.ts` - Generate and resolve shareable view links
- `api/_lib/db.ts` - Supabase client and database operations (incl. analytics aggregations, `ticker_news_summaries`, and `upcoming_events`)
- `api/_lib/redis.ts` - Upstash Redis read-through cache for snapshots, portfolio metadata, the portfolios list/count, and prices. Read endpoints (`portfolio`/`portfolios`/`history`/`permissions`) try Redis first and fall back to Supabase, backfilling the cache; the snapshot refresh writes through it.
- `api/_lib/yahoo.ts` - Yahoo Finance API for quotes, historical data, symbol info, and news
- `api/_lib/cache.ts` - Market hours / live-session detection utilities
- `api/_lib/snapshot.ts` - Snapshot computation logic for portfolios (incl. 1D intraday history)
- `api/_lib/anonymize.ts` - Strips dollar-denominated fields for the `allocation_only` share-link mode (keeps allocation %)
- `api/_lib/openai.ts` - OpenAI client + `generateDeepResearch` (deep research report generation)
- `api/_lib/prompts.ts` - Shared AI prompts (deep research report structure)
- `scripts/generate-research.ts` - Generate AI deep-research reports for portfolios
- `scripts/generate-news.sh` - VM-cron news generator: runs `claude -p` per asset class to research held tickers and persist per-ticker summaries (helpers: `prepare-news-input.ts`, `save-news-summary.ts`, `fetch-news.ts`; prompts in `news-prompt*.md`)
- `scripts/generate-events.sh` - VM-cron Upcoming Events generator: runs `claude -p` to research the macro calendar + held-ticker earnings, then persists the feed to `upcoming_events` (helpers: `prepare-events-input.ts` builds the held-stock input, `save-events.ts` persists; prompt in `events-prompt.md`; run artifacts in gitignored `scripts/events-output/`)
- `scripts/` - One-time migration scripts (e.g., `migrate-instrument-types.ts`, `migrate-upcoming-events.ts`)

### Database (Supabase PostgreSQL)
- `portfolios` table: id, display_name, password_hash, is_private, visibility, created_at
- `holdings` table: portfolio_id, ticker, name, shares, is_static, static_value, instrument_type, cost_basis
- `portfolio_viewers` table: portfolio_id, viewer_id (for selective visibility)
- `price_cache` table: ticker, current_price, previous_close, change_percent, updated_at
- `daily_prices` table: ticker, date, close_price (historical daily closing prices)
- `portfolio_snapshots` table: Pre-computed portfolio data with holdings, history, and benchmark (JSONB)
- `sessions` table: token, portfolio_id, is_admin, expires_at, created_at (issued by `api/login.ts`)
- `analytics_events` table: event_type (`view`/`login`), portfolio_id (nullable; null = landing page), viewer_id (nullable; null = anonymous), ip_address, user_agent, country/city/region, referer, created_at
- `ticker_news_summaries` table: ticker, AI summary markdown, sources (JSONB), summary_date — AI-generated per-ticker news, written by `scripts/generate-news.sh` and served by `api/news.ts`
- `upcoming_events` table: id, event_type (`macro`/`earnings`), event_date, event_time, title, detail, importance, tickers/holders (JSONB), holder_count, source (JSONB), position — the landing-page Upcoming Events feed (one ranked global list, replaced wholesale by `scripts/generate-events.sh`, served by `api/events.ts`)

### External APIs
- **Yahoo Finance** - Sole source for real-time quotes, historical data, and symbol info (free, no API key)

## Key Patterns

- Holdings are either "tradeable" (shares × price) or "static" (fixed value for non-market assets like real estate)
- `instrument_type` field categorizes holdings for the "By Type" panel (Common Stock → Stocks, ETF/Mutual Fund → Funds, Money Market → Cash / Money Market, etc.)
- Passwords are bcrypt hashed; portfolio CRUD requires password verification
- **Snapshot + Redis architecture**: Portfolio/history data is pre-computed in the background into the `portfolio_snapshots` table and fronted by a Redis cache. Read endpoints serve **Redis → snapshot → empty placeholder**, in that order. Portfolio create/edit triggers an immediate (non-blocking) snapshot refresh. The background refresh cadence, wrapper script, and the legacy `POST /api/refresh-prices` fallback are documented once under [Snapshot Refresh Cron](#snapshot-refresh-cron-hetzner-vm).
- Cost basis tracking: Holdings can have optional cost basis for gain/loss calculation
- Unrealized gain shown as both absolute value and percentage
- **Movers strip**: `src/components/MoversStrip.tsx` renders the "Top movers" pill on the landing page — the tickers swinging most today, ranked by breadth × |move| across publicly-visible (`public`/`allocation_public`) portfolios. The ranking is `computeMarketMovers` in `api/portfolios.ts`, returned as `{ regular, extended }` (one list per price basis; `LandingPage` picks one via the Extended Hours toggle, so the *ranking* switches with the basis). **Gotcha:** the display caps at `DISPLAY_COUNT` (3) rows in `MoversStrip.tsx`, which must stay in sync with `MOVER_MIN_COUNT` (3) in `api/portfolios.ts`. Layout/design rationale and rejected alternatives live in the component's code comments, not here.
- **Upcoming events strip**: `src/components/UpcomingEvents.tsx` renders the "Upcoming" pill directly below the movers strip on the landing page — a forward-looking feed of macro releases (CPI, FOMC, PCE, jobs, etc.) and earnings for stocks held by publicly-visible portfolios. Generated weekly (Sundays) by `scripts/generate-events.sh` into the `upcoming_events` table, served by `api/events.ts`, fetched via `useUpcomingEvents`. Mirrors the movers strip exactly: same card shell, a notepad-style folder tab on the card's top-left holding the icon + label, a centered expand/collapse toggle below the rows, and a `DISPLAY_COUNT` (3) cap; the generator emits `events.json` pre-ranked (date → importance → breadth) and `save-events.ts` stores that order in `position`, so the strip just slices the first N. The UI shows the **next events chronologically across all importance levels** (no client-side importance filter — the feed is already ranked date → importance → breadth, so the first `DISPLAY_COUNT` are the most imminent), and renders each as a `date | emoji | title` statement: a single decorative category emoji (`eventEmoji` in `UpcomingEvents.tsx` — 🏦 Fed/rates, 📈 inflation, 💼 jobs, 📊 growth, 🛍️ retail, 🏭 manufacturing, 💰 earnings; derived from the event, not stored) then a self-contained title, with no severity/impact dot and no ticker chip (earnings titles name the company, e.g. "Micron Q3 FY26 earnings"; the `events-prompt.md` title rule enforces self-contained, plain-language titles **kept ≤ 32 chars so each renders on a single line** — the title span uses `truncate` (one-line clip, never a second line) and `save-events.ts` warns on any title over the limit). Self-hides when the feed is empty. **Shared-tab gotcha:** the folder tab uses a fixed width (`w-36`) duplicated verbatim across all three stacked landing-page tabs (`MoversStrip`, `UpcomingEvents`, and the Users panel in `LandingPage.tsx`) so they line up at a constant width — change one, change all three.
- **Three AI-generated features (independent):**
  - **Per-ticker news** — `scripts/generate-news.sh` (VM cron) runs `claude -p` to research held tickers and writes `ticker_news_summaries`; `api/news.ts` serves them (with a Yahoo-article fallback) to `NewsTicker`/`NewsSection` via the `usePortfolioNews` hook.
  - **Upcoming events** — `scripts/generate-events.sh` (VM cron) runs `claude -p` to research the macro calendar + held-ticker earnings and writes `upcoming_events`; `api/events.ts` serves the feed to `UpcomingEvents` via the `useUpcomingEvents` hook. See [Upcoming Events Generation](#upcoming-events-generation-cron-hetzner-vm).
  - **Deep research** — `generateDeepResearch` (`api/_lib/openai.ts`, OpenAI deep-research model) via `scripts/generate-research.ts`, stored in `portfolios.deep_research`, rendered by `AIResearchSection`. See [AI Research Generation](#ai-research-generation).
- **Analytics events:**
  - Every page open fires `POST /api/log-view`. Portfolio routes use `useViewAnalytics` (mounted in `App.tsx`); the landing page uses `useLandingViewAnalytics` (mounted in `LandingPage.tsx`). Both fire on initial mount and on `visibilitychange → visible`.
  - `log-view` writes `event_type = 'view'` only. The `login` event type is emitted exclusively by `api/login.ts` at password verification — do not write `'login'` from anywhere else.
  - `portfolio_id = null` ⇒ landing-page view. `viewer_id = null` ⇒ anonymous visitor. In analytics aggregations, anonymous visitors are clustered by `(ip_address, user_agent)` so each unique device/network pair shows up as its own identity in the Viewer Activity (Anonymous) panel.
  - The Analytics Dashboard at `/analytics` is gated by `ADMIN_PASSWORD`.
- **Storage-backed hooks must hydrate synchronously.** Hooks that read from `localStorage`/`sessionStorage` (`useLoggedInPortfolio`, `useUnlockedPortfolios`) must initialize state via `useState(() => readStorage())` — **not** in a post-mount `useEffect`. Otherwise the first render sees a logged-out app, and any side effects firing in that window (analytics events, identified data fetches) carry no identity. This bug silently broke view-event attribution for weeks; don't reintroduce the pattern when adding new storage-backed hooks.

## Authentication & Permissions

- **Portfolio Login**: Users can "log in" to their portfolio using their password (stored in localStorage)
- **Three visibility modes**:
  - `public` - Anyone can view
  - `private` - Only owner with password
  - `selective` - Owner + specific invited users (when logged in)
- **Admin override**: `ADMIN_PASSWORD` env var allows viewing any private portfolio
- `useLoggedInPortfolio` hook manages login state across the app

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values. Required:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Backend database
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - Frontend (if using Supabase directly)
- `UPSTASH_REDIS_REST_KV_REST_API_URL`, `UPSTASH_REDIS_REST_KV_REST_API_TOKEN` - Upstash Redis cache (the doubled `_REST_KV_REST_` prefix comes from the Vercel integration — not a typo)
- `OPENAI_API_KEY` - Deep research generation (`scripts/generate-research.ts`)
- `REFRESH_SECRET` - Authentication token for background refresh endpoint (generate with `openssl rand -hex 32`)
- `ADMIN_PASSWORD` - Optional admin override for viewing private portfolios; also gates the `/analytics` dashboard

**Local development:** All secrets stored in `.env.local` (gitignored). Use `source .env.local` before running local scripts.

### Snapshot Refresh Cron (Hetzner VM)
Snapshot refresh runs on the VM via cron — see `scripts/VM_SETUP.md` section 10 for install steps.
- **Wrapper:** `scripts/refresh-snapshots.sh` (sources `.env.local`, `flock`s a lockfile, logs to `scripts/refresh-snapshots.log`)
- **Script:** `scripts/refresh-snapshots.ts` (calls `refreshAllSnapshots()` + `deleteExpiredSessions()` directly against Supabase; pass `--force` to bypass off-hours gating)
- **Crontab:** `* * * * * $HOME/foliotracker/scripts/refresh-snapshots.sh` — fires every minute; the script self-skips off-hours ticks (minute not in {0,30}).
- **Cadence:** every minute during live US sessions (pre-market + market + after-hours, Mon–Fri ET), every 30 minutes otherwise.
- The legacy `POST /api/refresh-prices` Vercel endpoint (`REFRESH_SECRET` auth) remains deployed as a manual fallback but is no longer driven on a schedule.

### News Generation Cron (Hetzner VM)
`scripts/generate-news.sh` runs daily via cron, invoking `claude -p` per asset class to refresh `ticker_news_summaries`. Requires `claude` on `PATH` plus `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` from `.env.local`. See `scripts/VM_SETUP.md`.

### Upcoming Events Generation (Cron, Hetzner VM)
`scripts/generate-events.sh` runs **weekly (Sundays 07:30 UTC)** via cron (same mechanism as the news generator), invoking a single `claude -p` session to research the upcoming US macro calendar (~14 days) and the next earnings date for each held stock (~21 days), then persists a ranked feed to `upcoming_events` via `save-events.ts`. Pipeline: `prepare-events-input.ts` (held stocks across publicly-visible portfolios, with holder breadth) → `claude -p` with `events-prompt.md` → `events.json`/`events.md` in `scripts/events-output/` → `save-events.ts` (replaces the whole feed). Requires `claude` on `PATH` plus `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`. Weekly (not daily) is sufficient because `api/events.ts` serves only future-dated rows so the feed self-advances between runs, and macro/earnings dates are known weeks ahead — see `scripts/VM_SETUP.md` section 11 for the full rationale and the install steps (crontab line `30 7 * * 0`).

## Database Migrations

**Direct Database Access:**
- `SUPABASE_DB_URL` in `.env.local` provides a direct postgres connection string
- Use the `pg` package (already installed) for migrations:
  ```bash
  source .env.local && npx tsx scripts/run-migration.ts
  ```

**Example Migration Script:**
```typescript
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();
await client.query('ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...');
await client.end();
```

## AI Research Generation

Generate AI research reports for portfolios using OpenAI's o4-mini-deep-research model.

**Script:** `scripts/generate-research.ts`

**Command:**
```bash
source .env.local && npx tsx scripts/generate-research.ts <portfolio_id>

# Or for all portfolios:
source .env.local && npx tsx scripts/generate-research.ts --all
```

**Notes:**
- Deep research takes 5-15 minutes per portfolio (timeout set to 1 hour)
- Script logs full request/response details for debugging
- Prompt is defined in `api/_lib/prompts.ts` (shared between script and API)
- Reports are stored in `portfolios.deep_research` column

## Database Backups

Local backup script using `pg_dump` against the Supabase DB.

```bash
source .env.local && bash scripts/backup-db.sh
```

- Dumps roles, schema, and data to `backups/<date>/`
- 30-day retention (auto-cleans old backups)
- **Automated on the Hetzner VM** via cron at 06:30 UTC every 3rd day of the month (see `scripts/VM_SETUP.md`). Previously ran on the Mac via launchd but lid-closed sleep kept missing the schedule.
- Logs to `backups/backup.log` on the VM

## Password Reset

Reset a forgotten portfolio password from the CLI:

```bash
source .env.local && npx tsx scripts/reset-password.ts <portfolio_id> <new_password>
```

This hashes the new password with bcrypt, updates the database, and invalidates all existing sessions for that portfolio.

## Workflow

- **Build-only by default**: after making changes, run `npm run build` to verify no errors. Don't deploy unless the user explicitly asks.
- **Deployment = git push**: the Vercel GitHub integration auto-deploys every push to `main` to production. The normal flow is: make changes → `npm run build` → commit + push when asked (e.g. `/cp`). "Commit and push" IS the deploy — no `vercel` CLI command is involved. Manual `vercel` / `vercel --prod` deploys are a fallback for special cases only (e.g. a preview without pushing to `main`).
- **Build costs:** Vercel uses a Standard build machine with on-demand concurrency disabled = $0/minute.
