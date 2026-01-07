-- Multi-Portfolio Support Migration
-- Run this in Supabase SQL Editor

-- Step 1: Create portfolios table
CREATE TABLE IF NOT EXISTS portfolios (
  id VARCHAR(20) PRIMARY KEY,
  display_name VARCHAR(50),
  password_hash VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Enable RLS on portfolios
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

-- Step 3: Allow public read access on portfolios
CREATE POLICY "Allow public read access on portfolios"
ON portfolios FOR SELECT
TO anon
USING (true);

-- Step 4: Add portfolio_id column to holdings
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS portfolio_id VARCHAR(20);

-- Step 5: Drop old primary key and create new one
-- First check if we need to migrate data
DO $$
BEGIN
  -- Only migrate if portfolio_id is null for any rows
  IF EXISTS (SELECT 1 FROM holdings WHERE portfolio_id IS NULL) THEN
    -- Create the first portfolio for existing data
    -- Replace 'your_portfolio_id', 'Your Portfolio', and the bcrypt hash with your own values
    -- Generate hash with: node -e "require('bcryptjs').hash('yourpassword', 10).then(console.log)"
    INSERT INTO portfolios (id, display_name, password_hash)
    VALUES ('demo', 'Demo Portfolio', '$2b$10$REPLACE_WITH_YOUR_BCRYPT_HASH')
    ON CONFLICT (id) DO NOTHING;

    -- Assign existing holdings to the portfolio
    UPDATE holdings SET portfolio_id = 'demo' WHERE portfolio_id IS NULL;
  END IF;
END $$;

-- Step 6: Drop old primary key constraint
ALTER TABLE holdings DROP CONSTRAINT IF EXISTS holdings_pkey;

-- Step 7: Make portfolio_id NOT NULL and add foreign key
ALTER TABLE holdings ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE holdings ADD CONSTRAINT holdings_portfolio_fk
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE;

-- Step 8: Create new composite primary key
ALTER TABLE holdings ADD PRIMARY KEY (portfolio_id, ticker);

-- Step 9: Create index for faster portfolio lookups
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON holdings(portfolio_id);
