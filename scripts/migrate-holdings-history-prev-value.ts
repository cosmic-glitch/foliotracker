#!/usr/bin/env npx tsx
/**
 * Add prev_static_value to holdings_history — the static holding's value
 * before an 'updated'/'removed' change, so the Changes tab can show the
 * dollar delta of a value edit. Mirrors supabase/migrations/012.
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
      'ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS prev_static_value DECIMAL(14,2)'
    );
    console.log('  Added prev_static_value column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
