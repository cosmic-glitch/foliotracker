#!/usr/bin/env npx tsx
/**
 * Create the upcoming_events table — the AI-generated landing-page "Upcoming
 * events" feed (macro releases + earnings for held tickers). The feed is a
 * single global ranked list, regenerated wholesale each run, so each row is one
 * event and the set is replaced on every generation (see replaceUpcomingEvents
 * in api/_lib/db.ts).
 *
 * Usage:
 *   source .env.local && npx tsx scripts/migrate-upcoming-events.ts
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

  try {
    console.log('Creating upcoming_events table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS upcoming_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,            -- 'macro' | 'earnings'
        event_date DATE NOT NULL,
        event_time TEXT,                     -- '14:00 ET' | 'after close' | NULL
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        importance TEXT NOT NULL DEFAULT 'medium',  -- 'high' | 'medium' | 'low'
        tickers JSONB NOT NULL DEFAULT '[]',  -- reporting ticker(s); [] for macro
        holders JSONB,                        -- portfolio handles; NULL for macro
        holder_count INT NOT NULL DEFAULT 0,
        source JSONB,                         -- { title, url } | NULL
        position INT NOT NULL DEFAULT 0,      -- generator's ranking (display order)
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    console.log('Creating idx_upcoming_events_date index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_upcoming_events_date
        ON upcoming_events (event_date)
    `);

    console.log('\nMigration successful!');

    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'upcoming_events'
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
