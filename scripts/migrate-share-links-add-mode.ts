#!/usr/bin/env npx tsx
/**
 * Add `mode` column to share_links so an owner can choose what a share link reveals.
 *   - 'full': existing behaviour (entire portfolio, dollar amounts and all).
 *   - 'allocation_only': stripped + indexed view (no $, no shares, no absolute gains).
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
    await client.query(`
      ALTER TABLE share_links
        ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full'
    `);
    console.log('  Added mode column (or already existed)');

    // Add CHECK constraint separately so we can guard with IF NOT EXISTS via DO block.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'share_links_mode_check'
        ) THEN
          ALTER TABLE share_links
            ADD CONSTRAINT share_links_mode_check
            CHECK (mode IN ('full', 'allocation_only'));
        END IF;
      END $$;
    `);
    console.log('  Added share_links_mode_check constraint (or already existed)');

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'share_links'
      ORDER BY ordinal_position
    `);

    console.log('\nVerification:');
    for (const row of result.rows) {
      console.log(
        `  ${row.column_name}: ${row.data_type} (nullable=${row.is_nullable}, default=${row.column_default ?? 'NULL'})`
      );
    }

    const modeRow = result.rows.find((r) => r.column_name === 'mode');
    if (!modeRow) {
      throw new Error('mode column not found after migration');
    }
    if (modeRow.is_nullable !== 'NO') {
      throw new Error('mode column should be NOT NULL');
    }

    const counts = await client.query(`SELECT mode, COUNT(*)::int AS n FROM share_links GROUP BY mode`);
    console.log('\nRows by mode:');
    if (counts.rows.length === 0) {
      console.log('  (table empty)');
    } else {
      for (const r of counts.rows) {
        console.log(`  ${r.mode}: ${r.n}`);
      }
    }

    console.log('\nMigration successful!');
    await client.end();
  } catch (error) {
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }
}

main();
