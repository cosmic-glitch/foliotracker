-- Portfolio History: one row per portfolio per trading day — total value at
-- the regular-session close plus the per-holding breakdown that day (drives
-- the allocation-history chart). Written by the VM snapshot cron after each
-- close (source 'recorded'); rows before recording began were backfilled from
-- DB backups + the holdings_history log ('reconstructed' = holdings known for
-- that day, 'estimated' = holdings carried from the nearest known day).
CREATE TABLE IF NOT EXISTS portfolio_daily_values (
  portfolio_id VARCHAR(20) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_value DECIMAL(16,2) NOT NULL,
  -- [{ticker, name, shares, value, isStatic, instrumentType}]
  holdings JSONB NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('recorded', 'reconstructed', 'estimated')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, date)
);

ALTER TABLE portfolio_daily_values ENABLE ROW LEVEL SECURITY;
-- Service role only; no anon policy (accessed via service key in api/_lib/db.ts)
