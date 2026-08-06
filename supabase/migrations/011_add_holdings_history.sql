-- Holdings history: append-only log of share/unit changes per portfolio
-- Not applied in dev-complete mode; code must degrade gracefully when table missing.

CREATE TABLE IF NOT EXISTS holdings_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id VARCHAR(20) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  shares DECIMAL(14,4) NOT NULL,
  prev_shares DECIMAL(14,4),
  is_static BOOLEAN NOT NULL DEFAULT FALSE,
  static_value DECIMAL(14,2),
  instrument_type VARCHAR(50),
  cost_basis DECIMAL(14,2),
  change_type VARCHAR(10) NOT NULL CHECK (change_type IN ('added','updated','removed')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holdings_history_portfolio_recorded
  ON holdings_history(portfolio_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_history_portfolio_ticker
  ON holdings_history(portfolio_id, ticker);

ALTER TABLE holdings_history ENABLE ROW LEVEL SECURITY;
-- Service role only; no anon policy (accessed via service key in api/_lib/db.ts)
