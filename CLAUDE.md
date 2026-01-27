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
- `api/lib/db.ts` - Supabase client and database operations
- `api/lib/yahoo.ts` - Yahoo Finance API for quotes, historical data, and symbol info
- `api/lib/cache.ts` - Market hours detection utilities
- `api/lib/snapshot.ts` - Snapshot computation logic for portfolios
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
  - External cron service (cron-job.org) triggers `/api/refresh-prices` endpoint
  - Refresh frequency: Every 1 minute during market hours, every 30 minutes after hours
  - Requires `REFRESH_SECRET` auth header
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

Copy `.env.example` to `.env`. Required:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Backend database
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - Frontend (if using Supabase directly)
- `REFRESH_SECRET` - Authentication token for background refresh endpoint (generate with `openssl rand -hex 32`)
- `REFRESH_URL` - Full URL to refresh endpoint (e.g., `https://foliotracker.vercel.app/api/refresh-prices`)
- `ADMIN_PASSWORD` - Optional admin override for viewing private portfolios

**Local development:** API keys are stored in `.env.local` (use `source .env.local` before running local scripts)

### External Cron Configuration (cron-job.org)
Snapshot refresh is handled by an external cron service at https://console.cron-job.org/
- **Endpoint:** `POST https://foliotracker.vercel.app/api/refresh-prices`
- **Auth header:** `Authorization: Bearer <REFRESH_SECRET>`
- **Schedule:** Every 1 minute during US market hours (9:30 AM - 4:00 PM ET), every 30 minutes otherwise

## Workflow

- **Preview-first deployment**: Always deploy to preview URL first, never directly to production
  1. Make changes and run `npm run build` to verify no errors
  2. Deploy to preview: `vercel` (without --prod)
  3. **Test the preview in the browser** before reporting completion to the user
  4. Provide preview URL to user for manual testing
  5. **Wait for user sign-off** before proceeding
  6. Only after approval: `vercel --prod` to deploy to production
