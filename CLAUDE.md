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
- `api/lib/fmp.ts` - Stock price API (Yahoo Finance primary, FMP fallback with retry logic)
- `api/lib/cache.ts` - Market hours detection utilities
- `api/lib/snapshot.ts` - Snapshot computation logic for portfolios

### Database (Supabase PostgreSQL)
- `portfolios` table: id, display_name, password_hash, is_private, visibility, created_at
- `holdings` table: portfolio_id, ticker, name, shares, is_static, static_value, instrument_type, cost_basis
- `portfolio_viewers` table: portfolio_id, viewer_id (for selective visibility)
- `price_cache` table: ticker, current_price, previous_close, change_percent, updated_at
- `daily_prices` table: ticker, date, close_price (historical daily closing prices)
- `portfolio_snapshots` table: Pre-computed portfolio data with holdings, history, and benchmark (JSONB)

### External APIs
- **Yahoo Finance** - Primary source for real-time quotes and historical data (free, no API key)
- **FMP (Financial Modeling Prep)** - Fallback for quotes when Yahoo fails, symbol info (requires API key)

## Key Patterns

- Holdings are either "tradeable" (shares × price) or "static" (fixed value for non-market assets like real estate)
- `instrument_type` field categorizes holdings for the "By Type" panel (Common Stock → Stocks, ETF/Mutual Fund → Funds, etc.)
- Passwords are bcrypt hashed; portfolio CRUD requires password verification
- **Snapshot-based architecture**: Portfolio data is pre-computed in the background every 5 minutes during market hours
  - GitHub Actions workflow triggers `/api/refresh-prices` endpoint (requires `REFRESH_SECRET` auth)
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
- `FMP_API_KEY` - Stock prices (Financial Modeling Prep fallback)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - Frontend (if using Supabase directly)
- `REFRESH_SECRET` - Authentication token for background refresh endpoint (generate with `openssl rand -hex 32`)
- `REFRESH_URL` - Full URL to refresh endpoint (e.g., `https://foliotracker.vercel.app/api/refresh-prices`)
- `ADMIN_PASSWORD` - Optional admin override for viewing private portfolios

### GitHub Secrets (for background refresh workflow)
Configure in repository Settings → Secrets and variables → Actions:
- `REFRESH_SECRET` - Same value as local `REFRESH_SECRET` env var
- `REFRESH_URL` - Full URL to your deployed `/api/refresh-prices` endpoint

## Workflow

- **Preview-first deployment**: Always deploy to preview URL first, never directly to production
  1. Make changes and run `npm run build` to verify no errors
  2. Deploy to preview: `vercel` (without --prod)
  3. Provide preview URL to user for manual testing
  4. **Wait for user sign-off** before proceeding
  5. Only after approval: `vercel --prod` to deploy to production
