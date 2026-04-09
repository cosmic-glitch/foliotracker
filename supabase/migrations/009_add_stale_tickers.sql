-- Add stale_tickers column to track which tickers used cached prices
ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS stale_tickers JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN portfolio_snapshots.stale_tickers IS 'Tickers that used cached prices because Yahoo Finance failed (empty array when all live)';
