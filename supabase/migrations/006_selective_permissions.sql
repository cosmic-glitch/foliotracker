-- Add visibility column to portfolios (replaces is_private)
ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public' NOT NULL;

-- Migrate existing is_private values to visibility
UPDATE portfolios SET visibility = 'private' WHERE is_private = true;

-- Create portfolio_viewers table for selective access
CREATE TABLE IF NOT EXISTS portfolio_viewers (
  portfolio_id VARCHAR(20) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  viewer_id VARCHAR(20) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, viewer_id)
);

-- Index for efficient lookups by viewer
CREATE INDEX IF NOT EXISTS idx_portfolio_viewers_viewer ON portfolio_viewers(viewer_id);

-- Add comments for documentation
COMMENT ON COLUMN portfolios.visibility IS 'Access control: public (anyone), private (password only), selective (allowed portfolio IDs)';
COMMENT ON TABLE portfolio_viewers IS 'Whitelist of portfolio IDs allowed to view a selective portfolio';
