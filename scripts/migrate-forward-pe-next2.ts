#!/usr/bin/env npx tsx
/**
 * Add forward_eps_next2 to fundamentals_cache — the FY+2 EPS estimate from
 * companiesmarketcap.org (pure projection, thinner analyst coverage than
 * forward_eps_next), alongside the existing forward_eps / forward_eps_next.
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
    await client.query(
      'ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS forward_eps_next2 NUMERIC'
    );
    console.log('  Added forward_eps_next2 column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
