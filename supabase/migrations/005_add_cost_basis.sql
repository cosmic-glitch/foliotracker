-- Add cost_basis column to holdings table
-- This stores the total cost basis in dollars (optional, for calculating profit/loss)
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS cost_basis DECIMAL(14, 2);
