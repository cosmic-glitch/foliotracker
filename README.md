# FolioTracker

A multi-portfolio stock tracker with real-time prices and historical performance charts.

**Live Demo:** [foliotracker.vercel.app](https://foliotracker.vercel.app)

## Features

- **Multi-portfolio support** - Create and manage multiple portfolios with password protection
- **Real-time prices** - Live stock, ETF, and mutual fund quotes
- **Performance charts** - Historical performance vs S&P 500 benchmark (1M to 3Y)
- **Holdings breakdown** - View allocations by instrument type (Stocks, ETFs, Funds, etc.)
- **Static assets** - Track non-market assets like real estate or cash with fixed values
- **Mobile responsive** - Works on desktop and mobile

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts
- **Backend:** Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL)
- **APIs:** Finnhub (stocks/ETFs), CNBC (mutual funds), Yahoo Finance (historical data)

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- Finnhub API key (free tier works)

### Installation

```bash
git clone https://github.com/cosmic-glitch/foliotracker.git
cd foliotracker
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# Backend (Vercel Serverless)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key
FINNHUB_API_KEY=your_finnhub_api_key

# Frontend (optional - for direct Supabase access)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### Database Setup

Run the migrations in order in your Supabase SQL Editor:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_multi_portfolio.sql`
3. `supabase/migrations/003_add_instrument_type.sql`

### Development

```bash
npm run dev      # Start frontend dev server
```

Note: API routes require deployment to Vercel or running `vercel dev` locally.

### Deployment

```bash
vercel           # Deploy to preview
vercel --prod    # Deploy to production
```

## Project Structure

```
├── api/                  # Vercel serverless functions
│   ├── portfolio.ts      # GET single portfolio
│   ├── portfolios.ts     # CRUD for portfolios
│   ├── history.ts        # Historical price data
│   └── lib/
│       ├── db.ts         # Supabase client
│       └── finnhub.ts    # Stock price APIs
├── src/
│   ├── components/       # React components
│   ├── hooks/            # Custom hooks
│   ├── pages/            # Page components
│   └── types/            # TypeScript interfaces
└── supabase/
    └── migrations/       # Database migrations
```

## License

MIT
