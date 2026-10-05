#!/usr/bin/env npx tsx
/**
 * Add shares_outstanding to fundamentals_cache — the implied share count
 * (companiesmarketcap.org marketCap ÷ its price, in the held ticker's share
 * units). The snapshot multiplies it by the live price for a market cap that
 * moves intraday, the same way forward P/E divides live price by forward EPS.
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
      'ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS shares_outstanding NUMERIC'
    );
    console.log('  Added shares_outstanding column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
