#!/usr/bin/env npx tsx
/**
 * Migration script to add deep_research columns to portfolios table
 *
 * Usage:
 *   source .env.local
 *   npx tsx scripts/migrate-deep-research.ts
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log('Checking if deep_research columns exist...');

  // Try to select the columns - if they don't exist, we'll get an error
  const { error: testError } = await supabase
    .from('portfolios')
    .select('deep_research, deep_research_at')
    .limit(1);

  if (testError) {
    console.error('Columns do not exist yet.');
    console.error('Please run the following SQL in your Supabase dashboard:\n');
    console.error('  ALTER TABLE portfolios ADD COLUMN deep_research TEXT;');
    console.error('  ALTER TABLE portfolios ADD COLUMN deep_research_at TIMESTAMPTZ;');
    console.error('\nSupabase Dashboard: https://supabase.com/dashboard/project/_/sql');
    process.exit(1);
  }

  console.log('Columns already exist! Migration not needed.');

  // Show current state
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, deep_research, deep_research_at');

  if (error) {
    console.error('Error fetching data:', error.message);
    process.exit(1);
  }

  console.log('\nCurrent deep_research status:');
  for (const p of data || []) {
    const status = p.deep_research ? `Generated (${p.deep_research.length} chars)` : 'Not generated';
    console.log(`  ${p.id}: ${status}`);
  }
}

main().catch(console.error);
