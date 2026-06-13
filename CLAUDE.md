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
- `src/main.tsx` - Router setup with routes: `/`, `/create`, `/:portfolioId`, `/:portfolioId/edit`, `/analytics`
- `src/App.tsx` - Main portfolio view page
- `src/pages/` - LandingPage, CreatePortfolio, EditPortfolio, AnalyticsDashboard
- `src/components/` - UI components (HoldingsTable, HoldingsByType, TotalValue, etc.)
- `src/hooks/usePortfolioData.ts` - Data fetching hook for portfolio API
- `src/hooks/useLoggedInPortfolio.ts` - Manages portfolio login state (localStorage, synchronous hydration)
- `src/hooks/useUnlockedPortfolios.ts` - Tracks portfolios unlocked this tab (sessionStorage, synchronous hydration)
- `src/hooks/useAnalytics.ts` - `useViewAnalytics` (portfolio routes) and `useLandingViewAnalytics` (landing page) fire `POST /api/log-view` on mount and on tab visibility change
- `src/types/portfolio.ts` - TypeScript interfaces for Holding, PortfolioData

### Backend (Vercel Serverless Functions)
- `api/portfolio.ts` - GET single portfolio (reads from pre-computed snapshots)
- `api/portfolios.ts` - CRUD for portfolios (GET list, POST create, PUT update, DELETE); also serves the analytics dashboard data and computes the landing-page market movers (`movers` field on the GET list response — `{ regular, extended }`, one ranked list per price basis)
- `api/history.ts` - Historical price data (reads from pre-computed snapshots)
- `api/refresh-prices.ts` - Background endpoint to refresh all portfolio snapshots
- `api/login.ts` - Password verification + session token issuance. Emits the `login` analytics event.
- `api/log-view.ts` - Emits `view` analytics events. Missing `portfolio_id` means a landing-page view (recorded with `portfolio_id = null`).
- `api/permissions.ts` - Portfolio viewer permissions (selective visibility)
- `api/share-links.ts` - Generate and resolve shareable view links
- `api/_lib/db.ts` - Supabase client and database operations (incl. analytics aggregations)
- `api/_lib/yahoo.ts` - Yahoo Finance API for quotes, historical data, and symbol info
- `api/_lib/cache.ts` - Market hours detection utilities
- `api/_lib/snapshot.ts` - Snapshot computation logic for portfolios
- `api/_lib/prompts.ts` - Shared AI prompts (deep research report structure)
- `scripts/generate-research.ts` - Generate AI research reports for portfolios
- `scripts/` - One-time migration scripts (e.g., `migrate-instrument-types.ts`)

### Database (Supabase PostgreSQL)
- `portfolios` table: id, display_name, password_hash, is_private, visibility, created_at
- `holdings` table: portfolio_id, ticker, name, shares, is_static, static_value, instrument_type, cost_basis
- `portfolio_viewers` table: portfolio_id, viewer_id (for selective visibility)
- `price_cache` table: ticker, current_price, previous_close, change_percent, updated_at
- `daily_prices` table: ticker, date, close_price (historical daily closing prices)
- `portfolio_snapshots` table: Pre-computed portfolio data with holdings, history, and benchmark (JSONB)
- `sessions` table: token, portfolio_id, is_admin, expires_at, created_at (issued by `api/login.ts`)
- `analytics_events` table: event_type (`view`/`login`), portfolio_id (nullable; null = landing page), viewer_id (nullable; null = anonymous), ip_address, user_agent, country/city/region, referer, created_at

### External APIs
- **Yahoo Finance** - Sole source for real-time quotes, historical data, and symbol info (free, no API key)

## Key Patterns

- Holdings are either "tradeable" (shares × price) or "static" (fixed value for non-market assets like real estate)
- `instrument_type` field categorizes holdings for the "By Type" panel (Common Stock → Stocks, ETF/Mutual Fund → Funds, Money Market → Cash / Money Market, etc.)
- Passwords are bcrypt hashed; portfolio CRUD requires password verification
- **Snapshot-based architecture**: Portfolio data is pre-computed in the background
  - Hetzner VM cron fires `scripts/refresh-snapshots.sh` every minute; the wrapped tsx script calls `refreshAllSnapshots()` directly against Supabase (no Vercel round-trip). See `scripts/VM_SETUP.md` section 10.
  - Cadence is gated in TypeScript (`isLiveMarketSession`): every minute during live US sessions (pre-market + market + after-hours, Mon–Fri ET), otherwise only at UTC minute `0` and `30`.
  - The `POST /api/refresh-prices` Vercel endpoint (`REFRESH_SECRET` bearer auth) still exists as a manual fallback but is no longer triggered on a schedule — the VM cron handles all scheduled refreshes.
  - All portfolio/history API endpoints read from pre-computed `portfolio_snapshots` table
  - Portfolio create/edit triggers immediate snapshot refresh (non-blocking)
  - Fallback: If snapshot doesn't exist, APIs return empty/placeholder data
- Cost basis tracking: Holdings can have optional cost basis for gain/loss calculation
- Unrealized gain shown as both absolute value and percentage
- **Movers strip**: `src/components/MoversStrip.tsx` renders a rounded pill above the landing page's Users card — the tickers swinging most today, weighted by how widely they're held. A left rail (**Top movers** under a lucide `Flame`) sits beside `DISPLAY_COUNT` (4) rows by default; a "N more" chevron under the label expands the pill to the full qualified set and collapses it back (frontend-only — the API already returns the whole list, the 4-row cap is a display-side slice). Each row is `ticker | day move | held-by`, where held-by names the holders (`held by AB, CD`, matching the Users list) when they fit the row and falls back to a count (`held by 3 users`) otherwise — a per-row, width-measured decision in a layout effect. The ranking lives in `computeMarketMovers` (`api/portfolios.ts`): every live stock/ETF held by ≥1 publicly-visible (`public`/`allocation_public`) portfolio is a candidate (GOOG/GOOGL merged; no minimum-holders floor), ranked by breadth × |move|. Stocks moving ≥2% and ETFs ≥1.5% (mutual funds excluded) are the "qualified" movers that lead; the function backfills the rest up to `MOVER_MIN_COUNT` (**4 — keep in sync with `DISPLAY_COUNT`**), so the strip is effectively always visible. It returns `{ regular, extended }` — two independent rankings by price basis; `LandingPage` shows one per the Extended Hours toggle (default off ⇒ regular), so the *ranking* (not just the shown %) switches with the basis. Each `MarketMover` carries `holders: string[]` (portfolio ids, creation order); since only publicly-visible portfolios contribute, naming holders leaks nothing not already public. **Detailed layout/design rationale and rejected alternatives live in the component's code comments, not here.**
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
- `REFRESH_SECRET` - Authentication token for background refresh endpoint (generate with `openssl rand -hex 32`)
- `ADMIN_PASSWORD` - Optional admin override for viewing private portfolios

**Local development:** All secrets stored in `.env.local` (gitignored). Use `source .env.local` before running local scripts.

### Snapshot Refresh Cron (Hetzner VM)
Snapshot refresh runs on the VM via cron — see `scripts/VM_SETUP.md` section 10 for install steps.
- **Wrapper:** `scripts/refresh-snapshots.sh` (sources `.env.local`, `flock`s a lockfile, logs to `scripts/refresh-snapshots.log`)
- **Script:** `scripts/refresh-snapshots.ts` (calls `refreshAllSnapshots()` + `deleteExpiredSessions()` directly against Supabase; pass `--force` to bypass off-hours gating)
- **Crontab:** `* * * * * $HOME/foliotracker/scripts/refresh-snapshots.sh` — fires every minute; the script self-skips off-hours ticks (minute not in {0,30}).
- **Cadence:** every minute during live US sessions (pre-market + market + after-hours, Mon–Fri ET), every 30 minutes otherwise.
- The legacy `POST /api/refresh-prices` Vercel endpoint (`REFRESH_SECRET` auth) remains deployed as a manual fallback but is no longer driven on a schedule.

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

- **Build-only by default**: After making changes, run `npm run build` to verify no errors. Do **not** deploy via the Vercel CLI — only deploy when the user explicitly asks.
- **Deployment = git push**: The Vercel GitHub integration auto-deploys every push to `main` to production. The normal flow is: make changes → `npm run build` → commit + push when the user asks (e.g. `/cp`). No `vercel` CLI command is needed or expected — "commit and push" IS the deploy.
- Manual CLI deploys (`vercel` for preview, `vercel --prod`) are a fallback for special cases only, e.g. testing a preview without pushing to `main`.
- **Build costs:** Vercel is configured with Standard build machine + on-demand concurrency disabled = $0/minute.
