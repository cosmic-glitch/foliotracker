#!/usr/bin/env npx tsx
/**
 * Create portfolio_daily_values — the Portfolio History screen's per-day
 * value + holdings rows. Mirrors supabase/migrations/015.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('Error: SUPABASE_DB_URL must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const sql = readFileSync(new URL('../supabase/migrations/015_add_portfolio_daily_values.sql', import.meta.url), 'utf8');
  const client = new pg.Client({ connectionString: dbUrl });

  console.log('Connecting to database...');
  await client.connect();

  console.log('Running migration...');

  try {
    await client.query(sql);
    console.log('  Created portfolio_daily_values');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
