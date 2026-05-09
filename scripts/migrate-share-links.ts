#!/usr/bin/env npx tsx
/**
 * Create share_links table for time-bounded portfolio share URLs.
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
      CREATE TABLE IF NOT EXISTS share_links (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        portfolio_id TEXT         NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
        token        TEXT         NOT NULL UNIQUE,
        label        TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ  NOT NULL,
        revoked_at   TIMESTAMPTZ
      )
    `);
    console.log('  Created share_links table (or already existed)');

    await client.query(`
      CREATE INDEX IF NOT EXISTS share_links_token_idx ON share_links (token)
    `);
    console.log('  Created share_links_token_idx');

    await client.query(`
      CREATE INDEX IF NOT EXISTS share_links_portfolio_id_idx ON share_links (portfolio_id)
    `);
    console.log('  Created share_links_portfolio_id_idx');

    // Verify
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'share_links'
      ORDER BY ordinal_position
    `);

    console.log('\nVerification:');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable=${row.is_nullable})`);
    }

    if (result.rows.length !== 7) {
      throw new Error(`Expected 7 columns, found ${result.rows.length}`);
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
