#!/usr/bin/env npx tsx
/**
 * Create ticker_news_summaries table for daily Claude-generated news summaries.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/migrate-ticker-news.ts
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
    console.log('Creating ticker_news_summaries table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_news_summaries (
        ticker TEXT NOT NULL,
        summary_date DATE NOT NULL,
        summary_markdown TEXT NOT NULL,
        sources_json JSONB NOT NULL DEFAULT '[]',
        model TEXT NOT NULL DEFAULT 'claude-code',
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (ticker, summary_date)
      )
    `);

    console.log('Creating idx_ticker_news_latest index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ticker_news_latest
        ON ticker_news_summaries (ticker, summary_date DESC)
    `);

    console.log('\nMigration successful!');

    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ticker_news_summaries'
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
