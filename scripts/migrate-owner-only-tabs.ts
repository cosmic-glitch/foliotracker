#!/usr/bin/env npx tsx
/**
 * Add gains_owner_only + changes_owner_only to portfolios — the Permissions
 * modal's "show CG / Changes tab only to me" switches. Mirrors
 * supabase/migrations/014.
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
      'ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS gains_owner_only BOOLEAN NOT NULL DEFAULT FALSE'
    );
    console.log('  Added gains_owner_only column');
    await client.query(
      'ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS changes_owner_only BOOLEAN NOT NULL DEFAULT FALSE'
    );
    console.log('  Added changes_owner_only column');
  } finally {
    await client.end();
  }

  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
