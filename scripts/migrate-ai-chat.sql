-- AI Chat Feature Migration
-- Run this SQL in Supabase SQL Editor

-- Add hot take columns to portfolios table
ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS hot_take TEXT,
ADD COLUMN IF NOT EXISTS hot_take_at TIMESTAMPTZ;

-- Create portfolio_chats table for chat history
CREATE TABLE IF NOT EXISTS portfolio_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_portfolio_chats_portfolio_id ON portfolio_chats(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_chats_created_at ON portfolio_chats(created_at);

-- Optional: Grant permissions if using RLS
-- ALTER TABLE portfolio_chats ENABLE ROW LEVEL SECURITY;
