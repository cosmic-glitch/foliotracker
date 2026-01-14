-- Create price_cache table for storing latest ticker prices
CREATE TABLE IF NOT EXISTS price_cache (
  ticker VARCHAR(20) PRIMARY KEY,
  current_price DECIMAL(20, 6) NOT NULL,
  previous_close DECIMAL(20, 6) NOT NULL,
  change_percent DECIMAL(10, 4) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for querying by freshness
CREATE INDEX IF NOT EXISTS idx_price_cache_updated ON price_cache(updated_at DESC);

-- Create daily_prices table for historical daily price data
CREATE TABLE IF NOT EXISTS daily_prices (
  ticker VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  close_price DECIMAL(20, 6) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (ticker, date)
);

-- Index for efficient date range queries
CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date ON daily_prices(ticker, date DESC);

-- Create portfolio_snapshots table for pre-computed portfolio data
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  portfolio_id VARCHAR(20) PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  total_value DECIMAL(20, 2) NOT NULL,
  day_change DECIMAL(20, 2) NOT NULL,
  day_change_percent DECIMAL(10, 4) NOT NULL,
  total_gain DECIMAL(20, 2),
  total_gain_percent DECIMAL(10, 4),
  holdings_json JSONB NOT NULL,
  history_30d_json JSONB,
  history_1d_json JSONB,
  benchmark_30d_json JSONB,
  market_status VARCHAR(20) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for querying by freshness
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_updated ON portfolio_snapshots(updated_at DESC);

-- Add comments for documentation
COMMENT ON TABLE price_cache IS 'Latest price data for all tickers (refreshed by background job)';
COMMENT ON TABLE daily_prices IS 'Historical daily closing prices (cached to reduce API calls)';
COMMENT ON TABLE portfolio_snapshots IS 'Pre-computed portfolio data with holdings, history, and benchmarks';
COMMENT ON COLUMN portfolio_snapshots.holdings_json IS 'Array of holdings with current values and allocations';
COMMENT ON COLUMN portfolio_snapshots.history_30d_json IS '30-day portfolio value history';
COMMENT ON COLUMN portfolio_snapshots.history_1d_json IS 'Intraday portfolio value history';
COMMENT ON COLUMN portfolio_snapshots.benchmark_30d_json IS 'SPY benchmark 30-day percent change history';
