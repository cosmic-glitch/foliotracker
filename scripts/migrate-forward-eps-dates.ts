#!/usr/bin/env npx tsx
/**
 * Add the fiscal-year-end date behind each forward EPS estimate to
 * fundamentals_cache (forward_eps_date / _next_date / _next2_date), from
 * companiesmarketcap.org's forwardEPS{,Next,Next2}Date. The PE tab labels each
 * forward PE with the month its fiscal year ends ("FY Jan 27").
 */

import pg from 'pg';

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;

  if (!dbUrl) {
    console.error('Error: SUPABASE_DB_URL must be set');
    console.error('Run: set -a; source .env.local; set +a');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });

  console.log('Connecting to database...');
  await client.connect();

  console.log('Running migration...');

  try {
    for (const column of ['forward_eps_date', 'forward_eps_next_date', 'forward_eps_next2_date']) {
      await client.query(`ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS ${column} DATE`);
      console.log(`  Added ${column} column`);
    }
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
