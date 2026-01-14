-- Add error tracking to portfolio_snapshots table
ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN portfolio_snapshots.last_error IS 'Last error message from snapshot refresh (null if successful)';
COMMENT ON COLUMN portfolio_snapshots.last_error_at IS 'Timestamp of last error (null if no error or successful after error)';
