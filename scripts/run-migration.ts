#!/usr/bin/env npx tsx
/**
 * Run SQL migration via direct Postgres connection
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
    await client.query('ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS deep_research TEXT');
    console.log('  Added deep_research column');

    await client.query('ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS deep_research_at TIMESTAMPTZ');
    console.log('  Added deep_research_at column');

    console.log('\nMigration successful!');

    // Verify
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'portfolios'
      AND column_name IN ('deep_research', 'deep_research_at')
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
