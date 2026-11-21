#!/usr/bin/env npx tsx
/**
 * Add day_closed_json to portfolio_snapshots — lines sold out today, for the
 * trade-aware day change. Mirrors supabase/migrations/017.
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
  await client.connect();
  try {
    await client.query('ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS day_closed_json JSONB');
    console.log('  Added day_closed_json column');
  } finally {
    await client.end();
  }
  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
