#!/usr/bin/env npx tsx
/**
 * Create the market_pulse table — the AI-generated landing-page market
 * snapshot (scripts/generate-pulse.sh). Append-only: one row per generation,
 * the API serves the newest.
 *
 * Usage:
 *   set -a; source .env.local; set +a && npx tsx scripts/migrate-market-pulse.ts
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

  try {
    console.log('Creating market_pulse table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_pulse (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        market_status TEXT NOT NULL,          -- 'open' | 'pre-market' | 'after-hours' | 'closed'
        headline TEXT NOT NULL,
        body TEXT NOT NULL,
        sources JSONB NOT NULL DEFAULT '[]',  -- [{ title, url }]
        model TEXT,
        input JSONB                           -- market data the generator was given
      )
    `);

    // RLS on with no policies: the anon key (shipped in the browser bundle)
    // can't read it via PostgREST; the server's service key bypasses RLS. Keeps
    // the api/events.ts?type=pulse viewer gate from being sidestepped.
    console.log('Enabling row level security...');
    await client.query(`ALTER TABLE market_pulse ENABLE ROW LEVEL SECURITY`);

    console.log('Creating idx_market_pulse_generated_at index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_market_pulse_generated_at
        ON market_pulse (generated_at DESC)
    `);

    console.log('\nMigration successful!');

    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'market_pulse'
      ORDER BY ordinal_position
    `);

    console.log('\nVerification (columns):');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }

  await client.end();
}

main();
