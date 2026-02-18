#!/usr/bin/env npx tsx
/**
 * Migration: Create fundamentals_cache table for companiesmarketcap data
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
      CREATE TABLE IF NOT EXISTS fundamentals_cache (
        ticker         TEXT PRIMARY KEY,
        revenue        NUMERIC,
        earnings       NUMERIC,
        forward_eps    NUMERIC,
        week_52_high   NUMERIC,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log('  Created fundamentals_cache table');

    console.log('\nMigration successful!');

    // Verify
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'fundamentals_cache'
      ORDER BY ordinal_position
    `);

    console.log('\nVerification:');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    }

    await client.end();
  } catch (error) {
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }
}

main();
