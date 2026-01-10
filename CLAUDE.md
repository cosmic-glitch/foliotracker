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
- `src/types/portfolio.ts` - TypeScript interfaces for Holding, PortfolioData

### Backend (Vercel Serverless Functions)
- `api/portfolio.ts` - GET single portfolio with holdings and prices
- `api/portfolios.ts` - CRUD for portfolios (GET list, POST create, PUT update, DELETE)
- `api/history.ts` - Historical price data
- `api/lib/db.ts` - Supabase client and database operations
- `api/lib/finnhub.ts` - Stock price API (FMP for stocks/ETFs, CNBC for mutual funds, Twelve Data for names)
- `api/lib/cache.ts` - Price cache staleness logic

### Database (Supabase PostgreSQL)
- `portfolios` table: id, display_name, password_hash, created_at
- `holdings` table: portfolio_id, ticker, name, shares, is_static, static_value, instrument_type
- `price_cache` table: ticker, current_price, previous_close, updated_at

### External APIs
- **FMP (Financial Modeling Prep)** - Real-time stock/ETF prices and historical data
- **CNBC** - Mutual fund NAV prices (no API key needed)
- **Twelve Data** - Symbol search for company names and instrument types

## Key Patterns

- Holdings are either "tradeable" (shares × price) or "static" (fixed value for non-market assets like real estate)
- `instrument_type` field categorizes holdings for the "By Type" panel (Common Stock → Stocks, ETF/Mutual Fund → Funds, etc.)
- Passwords are bcrypt hashed; portfolio CRUD requires password verification
- Price cache refreshes based on market hours (more frequent when open)

## Environment Variables

Copy `.env.example` to `.env`. Required:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Backend database
- `FMP_API_KEY` - Stock prices (Financial Modeling Prep)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - Frontend (if using Supabase directly)
