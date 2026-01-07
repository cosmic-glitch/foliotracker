# AV Portfolio - Specification Document

## Overview

A single-page web application that displays a real-time portfolio tracker. The site will be publicly accessible for friends to view, containing no personally identifiable information (PII).

**Live URL**: https://avfolio.vercel.app

## Portfolio Data

| Holding | Value ($k) | Allocation (%) |
|---------|------------|----------------|
| VUG | 4,174.9 | 21.1 |
| VGT | 3,323.3 | 16.8 |
| NVDA | 3,110.2 | 15.7 |
| META | 2,452.0 | 12.4 |
| GOOG | 1,895.4 | 9.6 |
| Real Estate | 1,526.5 | 7.7 |
| VWUAX | 1,499.2 | 7.6 |
| TSM | 893.0 | 4.5 |
| VOO | 605.4 | 3.1 |
| VMFXX | 187.3 | 0.9 |
| Rest | 94.8 | 0.5 |
| **Total** | **~19,762** | **100** |

## Features

### 1. Total Portfolio Value Display
- Large, prominent display of current total portfolio value
- Show absolute dollar change and percentage change for the last trading day
- Color-coded indicator (green for gain, red for loss)
- **S&P 500 Benchmark**: Shows SPY daily % change alongside portfolio performance for comparison

### 2. Holdings Table
- List all portfolio constituents sorted by value (largest first)
- Display for each holding:
  - Ticker/Name
  - Current value
  - Allocation percentage (with visual progress bars scaled to max allocation)
  - 1-day change ($ and %)
- Compact row spacing for information density

### 3. Holdings By Type Panel
- Aggregated view of holdings grouped by category:
  - **Index Funds**: VUG, VGT, VOO, VWUAX
  - **Individual Stocks**: NVDA, META, GOOG, TSM
  - **Real Estate**: Real Estate
  - **Cash / T-Bills**: VMFXX, Rest
- Shows total value, allocation %, and day change per category
- Color-coded progress bars for each type

### 4. Market Status Indicator
- Displayed in header showing current market state:
  - "Market Open" (green pulsing dot) - 9:30 AM - 4:00 PM ET, Mon-Fri
  - "Pre-Market" (amber) - 4:00 AM - 9:30 AM ET
  - "After Hours" (amber) - 4:00 PM - 8:00 PM ET
  - "Market Closed" (gray) - nights, weekends, holidays

### 5. Last Updated Timestamp
- Display when data was last refreshed
- Manual refresh button
- Auto-refresh every 5 minutes

## Technical Architecture

### Frontend
- **Framework**: React 19 with Vite (fast, modern tooling)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 with custom dark theme
- **Deployment**: Vercel (free tier, serverless functions included)

### Data Sources

#### Primary API: Finnhub
- **Free tier**: 60 API calls/minute
- **Features**: Real-time quotes for stocks and ETFs
- **Documentation**: https://finnhub.io/docs/api
- **Why Finnhub**: Well-documented, reliable, generous free tier, official API
- **Note**: Historical candle data not available on free tier (30-day chart removed)

#### Supported Tickers
| Ticker | Type | API Source |
|--------|------|------------|
| VUG | ETF | Finnhub |
| VGT | ETF | Finnhub |
| NVDA | Stock | Finnhub |
| META | Stock | Finnhub |
| GOOG | Stock | Finnhub |
| TSM | Stock | Finnhub |
| VOO | ETF | Finnhub |
| SPY | ETF | Finnhub (benchmark only) |
| VWUAX | Mutual Fund | Static (Finnhub doesn't support MFs) |
| VMFXX | Money Market | Static (price always ~$1.00) |
| Real Estate | Private | Static (manually updated) |
| Rest | Mixed | Static (manually updated) |

### Database & Caching Strategy

#### Database: Supabase (PostgreSQL)
- **Free tier**: 500MB storage, unlimited API requests
- **Why Supabase**: Free PostgreSQL hosting, easy setup, REST API included, works well with Vercel

#### Schema

```sql
-- Store daily closing prices for historical chart
CREATE TABLE daily_prices (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  close_price DECIMAL(12, 4) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(ticker, date)
);

-- Store current/intraday price cache
CREATE TABLE price_cache (
  ticker VARCHAR(10) PRIMARY KEY,
  current_price DECIMAL(12, 4) NOT NULL,
  previous_close DECIMAL(12, 4) NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Store static holdings (Real Estate, Rest, etc.)
CREATE TABLE static_holdings (
  ticker VARCHAR(20) PRIMARY KEY,
  display_name VARCHAR(50) NOT NULL,
  value DECIMAL(14, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast historical queries
CREATE INDEX idx_daily_prices_ticker_date ON daily_prices(ticker, date DESC);
```

#### Caching Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRICE FETCH FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Request for current price                                      │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────┐                                       │
│  │ Check price_cache   │                                       │
│  │ for ticker          │                                       │
│  └──────────┬──────────┘                                       │
│             │                                                   │
│    ┌────────┴────────┐                                         │
│    │                 │                                         │
│    ▼                 ▼                                         │
│  Cache HIT        Cache MISS or STALE                          │
│    │                 │                                         │
│    │                 ▼                                         │
│    │         ┌─────────────────┐                               │
│    │         │ Is market open? │                               │
│    │         └────────┬────────┘                               │
│    │           │             │                                 │
│    │          YES            NO                                │
│    │           │             │                                 │
│    │           ▼             ▼                                 │
│    │     Cache valid    Cache valid until                      │
│    │     for 5 min      next market open                       │
│    │           │             │                                 │
│    │           └──────┬──────┘                                 │
│    │                  │                                        │
│    │                  ▼                                        │
│    │         ┌─────────────────┐                               │
│    │         │ Fetch from      │                               │
│    │         │ Finnhub API     │                               │
│    │         └────────┬────────┘                               │
│    │                  │                                        │
│    │                  ▼                                        │
│    │         ┌─────────────────┐                               │
│    │         │ Update cache    │                               │
│    │         │ in Supabase     │                               │
│    │         └────────┬────────┘                               │
│    │                  │                                        │
│    └──────────────────┴───────────► Return price               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Cache TTL Rules

| Scenario | Cache Duration | Rationale |
|----------|---------------|-----------|
| Market hours (9:30 AM - 4:00 PM ET, Mon-Fri) | 5 minutes | Prices change frequently |
| Pre-market (4:00 AM - 9:30 AM ET) | 5 minutes | Some movement, less critical |
| After hours (4:00 PM - 8:00 PM ET) | 15 minutes | Limited trading |
| Market closed (nights, weekends, holidays) | Until next market open | Prices don't change |
| Historical daily data | Forever | Past data never changes |
| Static holdings | Until manually updated | No API source |

#### API Call Optimization

With 9 tradeable tickers (excluding static holdings):
- **Worst case** (all cache misses): 9 calls per page load
- **Typical case** (cache hits): 0-2 calls per page load
- **Daily historical backfill**: ~9 calls/day (once per ticker after market close)

At 60 calls/minute free tier, this is well within limits even with multiple concurrent users.

### Data Model

```typescript
interface Holding {
  ticker: string;
  name: string;
  shares: number;           // Number of shares owned
  currentPrice: number;     // Current price per share
  previousClose: number;    // Previous day's closing price
  value: number;            // shares * currentPrice
  allocation: number;       // Percentage of total portfolio
  dayChange: number;        // Dollar change today
  dayChangePercent: number; // Percentage change today
  isStatic: boolean;        // True for Real Estate, Rest, VWUAX, VMFXX
}

interface BenchmarkData {
  ticker: string;           // "SPY"
  name: string;             // "S&P 500"
  dayChangePercent: number; // Daily % change
}

type MarketStatus = 'open' | 'pre-market' | 'after-hours' | 'closed';

interface PortfolioData {
  totalValue: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  holdings: Holding[];
  historicalData: { date: string; value: number }[];  // Currently unused
  lastUpdated: Date;
  marketStatus: MarketStatus;
  benchmark: BenchmarkData | null;
}

interface CachedPrice {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  updatedAt: Date;
  isStale: boolean;
}
```

### Share Counts (Derived from Initial Values)
To track real-time values, we need the number of shares. These will be calculated based on the initial values provided and locked in:

```
shares = initialValue / priceAtSetup
```

This ensures the portfolio tracks actual market movements.

### Backend Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser   │────▶│  Vercel Edge     │────▶│  Supabase   │
│   (React)   │◀────│  Functions       │◀────│  (Postgres) │
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                             │ (only if cache miss)
                             ▼
                    ┌─────────────────┐
                    │   Finnhub API   │
                    └─────────────────┘
```

#### API Routes (Vercel Serverless Functions)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/portfolio` | GET | Get current portfolio with all holdings |
| `/api/history` | GET | Get 30-day historical data for chart |
| `/api/refresh` | POST | Force refresh prices (admin only) |

## Design Requirements

### Visual Style
- **Theme**: Dark mode with accent colors (modern, professional look)
- **Typography**: Clean sans-serif font (Inter, SF Pro, or similar)
- **Colors**:
  - Background: Dark gray/navy (#0f172a or similar)
  - Cards: Slightly lighter (#1e293b)
  - Positive: Green (#22c55e)
  - Negative: Red (#ef4444)
  - Accent: Blue (#3b82f6)

### Layout
```
┌─────────────────────────────────────────────────────────┐
│  AV Portfolio                          ● Market Closed  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Total Portfolio Value                                   │
│  $19,762,000                                            │
│                                                          │
│  ┌─────────────────────┐  ┌──────────────┐              │
│  │ +$125,400           │  │    +0.45%    │              │
│  │ +0.64% today        │  │   S&P 500    │              │
│  └─────────────────────┘  └──────────────┘              │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────┐ ┌────────────────────┐ │
│  │ Holdings                    │ │ By Type            │ │
│  │                             │ │                    │ │
│  │ VUG      $4.17M  ████ 21.1% │ │ Index Funds  49.2% │ │
│  │ VGT      $3.32M  ███  16.8% │ │ ████████████       │ │
│  │ NVDA     $3.11M  ███  15.7% │ │                    │ │
│  │ META     $2.45M  ██   12.4% │ │ Stocks      42.2%  │ │
│  │ GOOG     $1.90M  ██    9.6% │ │ ██████████         │ │
│  │ ...      ...     ...   ...  │ │                    │ │
│  └─────────────────────────────┘ │ Real Estate   7.7% │ │
│                                  │ ██                 │ │
│                                  │                    │ │
│                                  │ Cash/T-Bills  1.4% │ │
│                                  │ █                  │ │
│                                  └────────────────────┘ │
│                                                          │
├─────────────────────────────────────────────────────────┤
│  Last updated: Jan 4, 2026 4:00 PM    [Refresh]         │
└─────────────────────────────────────────────────────────┘
```

### Responsive Design
- Desktop: Two-column layout (Holdings 2/3, By Type 1/3)
- Tablet/Mobile: Single column, stacked panels

## Security & Privacy

- No PII displayed (no name, account numbers, etc.)
- No authentication required (public read-only access)
- API keys stored in environment variables (server-side only)
- Supabase Row Level Security (RLS) enabled - read-only public access
- Rate limiting on API routes to prevent abuse

## Environment Variables

```bash
# Finnhub
FINNHUB_API_KEY=your_finnhub_api_key

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key  # Server-side only
```

## Future Enhancements (Out of Scope for V1)

- Historical performance chart (requires Finnhub paid tier for candle data)
- Multiple time range options (1W, 1M, 3M, 1Y, ALL)
- Sector breakdown visualization
- Email/push notifications for significant changes
- Export to CSV functionality
- Scheduled cron job to backfill historical data automatically

## Development Phases

### Phase 1: Setup & Static Prototype
- Initialize React + Vite + TypeScript project
- Set up Tailwind CSS
- Build UI components with hardcoded sample data
- Implement responsive design and chart visualization

### Phase 2: Database Setup
- Create Supabase project
- Set up database schema and indexes
- Configure Row Level Security
- Seed initial data (share counts, static holdings)

### Phase 3: API Integration
- Create Vercel serverless functions
- Implement Finnhub API integration
- Build caching layer with cache invalidation logic
- Add Alpha Vantage fallback for mutual funds

### Phase 4: Connect Frontend to Backend
- Wire up React to API endpoints
- Implement auto-refresh with smart polling
- Add loading states and error handling

### Phase 5: Historical Data
- Implement daily price snapshot job
- Build 30-day chart with real historical data
- Backfill historical data for existing tickers

### Phase 6: Deployment & Polish
- Deploy to Vercel
- Set up custom domain (optional)
- Performance optimization
- Testing across devices

## File Structure

```
anurag_website/
├── public/
│   └── vite.svg
├── src/
│   ├── components/
│   │   ├── index.ts              # Barrel exports
│   │   ├── Header.tsx            # Logo + market status badge
│   │   ├── TotalValue.tsx        # Total value + day change + benchmark
│   │   ├── HoldingsTable.tsx     # Holdings list with allocation bars
│   │   ├── HoldingsByType.tsx    # Aggregated by category
│   │   ├── Footer.tsx            # Last updated + refresh button
│   │   └── LoadingSkeleton.tsx   # Loading state UI
│   ├── hooks/
│   │   └── usePortfolioData.ts   # Data fetching + state management
│   ├── lib/
│   │   └── mockData.ts           # Fallback demo data
│   ├── types/
│   │   └── portfolio.ts          # TypeScript interfaces
│   ├── utils/
│   │   └── formatters.ts         # Currency/percent formatting
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                 # Tailwind + custom theme
├── api/                          # Vercel serverless functions
│   ├── portfolio.ts              # Main API endpoint
│   ├── history.ts                # Historical data (currently unused)
│   └── lib/
│       ├── finnhub.ts            # Finnhub API client
│       ├── cache.ts              # Market hours + cache TTL logic
│       └── db.ts                 # Supabase database operations
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json
├── .env                          # Environment variables (not committed)
└── SPEC.md                       # This file
```

## Success Criteria

1. Page loads in under 2 seconds
2. Data refreshes automatically every 5 minutes
3. API calls minimized through intelligent caching (target: <20 calls/hour typical usage)
4. Mobile-friendly and accessible
5. Visually appealing dark theme
6. Accurate real-time price data for all tradeable securities
7. S&P 500 benchmark comparison displayed
8. Market status indicator shows current trading session
