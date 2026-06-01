# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `src/main.tsx` - Router setup with routes: `/`, `/create`, `/:portfolioId`, `/:portfolioId/edit`
- `src/App.tsx` - Main portfolio view page
- `src/pages/` - LandingPage, CreatePortfolio, EditPortfolio
- `src/components/` - UI components (HoldingsTable, HoldingsByType, TotalValue, etc.)
- `src/hooks/usePortfolioData.ts` - Data fetching hook for portfolio API
- `src/hooks/useLoggedInPortfolio.ts` - Manages portfolio login state (localStorage)
- `src/types/portfolio.ts` - TypeScript interfaces for Holding, PortfolioData

### Backend (Vercel Serverless Functions)
- `api/portfolio.ts` - GET single portfolio (reads from pre-computed snapshots)
- `api/portfolios.ts` - CRUD for portfolios (GET list, POST create, PUT update, DELETE)
- `api/history.ts` - Historical price data (reads from pre-computed snapshots)
- `api/refresh-prices.ts` - Background endpoint to refresh all portfolio snapshots
- `api/_lib/db.ts` - Supabase client and database operations
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

- **Build-only by default**: After making changes, run `npm run build` to verify no errors. Do **not** auto-deploy to Vercel preview — only deploy when the user explicitly asks.
- **Preview-first deployment**: When deploying, always deploy to preview URL first, never directly to production
  1. Deploy to preview: `vercel` (without --prod)
  2. Provide preview URL to user and **wait for user guidance** before proceeding
  3. Only after approval: `vercel --prod` to deploy to production
  - **Build costs:** Vercel is configured with Standard build machine + on-demand concurrency disabled = $0/minute.
