#!/usr/bin/env npx tsx
/**
 * Add price_override + note to holdings_history — owner price corrections and
 * free-text annotations for change-log rows. Mirrors supabase/migrations/013.
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
      'ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS price_override DECIMAL(14,4)'
    );
    console.log('  Added price_override column');
    await client.query(
      'ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS note VARCHAR(60)'
    );
    console.log('  Added note column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
