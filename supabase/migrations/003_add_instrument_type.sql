-- Add instrument_type column to holdings table
-- This stores the type of instrument (Common Stock, ETF, Mutual Fund, Cash, Real Estate, etc.)
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS instrument_type TEXT;
