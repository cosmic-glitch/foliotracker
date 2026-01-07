-- Portfolio Tracker Database Schema
-- Run this in Supabase SQL Editor to set up the database

-- Store daily closing prices for historical chart
CREATE TABLE IF NOT EXISTS daily_prices (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  close_price DECIMAL(12, 4) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(ticker, date)
);

-- Store current/intraday price cache
CREATE TABLE IF NOT EXISTS price_cache (
  ticker VARCHAR(10) PRIMARY KEY,
  current_price DECIMAL(12, 4) NOT NULL,
  previous_close DECIMAL(12, 4) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Store portfolio holdings configuration
CREATE TABLE IF NOT EXISTS holdings (
  ticker VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  shares DECIMAL(14, 4) NOT NULL,
  is_static BOOLEAN DEFAULT FALSE,
  static_value DECIMAL(14, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast historical queries
CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date
ON daily_prices(ticker, date DESC);

-- Enable Row Level Security
ALTER TABLE daily_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Allow public read access on daily_prices"
ON daily_prices FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow public read access on price_cache"
ON price_cache FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow public read access on holdings"
ON holdings FOR SELECT
TO anon
USING (true);

-- Insert initial holdings data
-- Share counts calculated from $ values as of Jan 3, 2026 close prices
INSERT INTO holdings (ticker, name, shares, is_static, static_value) VALUES
  ('VUG', 'Vanguard Growth ETF', 8587.21, false, null),
  ('VGT', 'Vanguard Info Tech ETF', 4396.02, false, null),
  ('NVDA', 'NVIDIA Corporation', 16469.68, false, null),
  ('META', 'Meta Platforms', 3770.00, false, null),
  ('GOOG', 'Alphabet Inc.', 6011.33, false, null),
  ('TSM', 'Taiwan Semiconductor', 2793.94, false, null),
  ('VOO', 'Vanguard S&P 500 ETF', 963.55, false, null),
  ('VWUAX', 'Vanguard Growth Fund', 1, true, 1499200),
  ('VMFXX', 'Vanguard Money Market', 1, true, 187300),
  ('Real Estate', 'Real Estate', 1, true, 1526500),
  ('Rest', 'Other Holdings', 1, true, 94800)
ON CONFLICT (ticker) DO UPDATE SET
  name = EXCLUDED.name,
  shares = EXCLUDED.shares,
  is_static = EXCLUDED.is_static,
  static_value = EXCLUDED.static_value,
  updated_at = NOW();
