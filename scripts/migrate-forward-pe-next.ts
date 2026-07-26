#!/usr/bin/env npx tsx
/**
 * Add forward_eps_next to fundamentals_cache — the next-fiscal-year EPS
 * estimate from companiesmarketcap.org (pure projection, no reported
 * quarters), alongside the existing ongoing-FY forward_eps.
 */

import pg from 'pg';

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('Error: SUPABASE_DB_URL must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });

  console.log('Connecting to database...');
  await client.connect();

  console.log('Running migration...');

  try {
    await client.query(
      'ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS forward_eps_next NUMERIC'
    );
    console.log('  Added forward_eps_next column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
