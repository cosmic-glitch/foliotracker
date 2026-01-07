-- Add is_private column to portfolios table
ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN portfolios.is_private IS 'When true, portfolio values are hidden on landing page and require password to view details';
