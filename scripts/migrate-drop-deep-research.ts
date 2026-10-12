#!/usr/bin/env npx tsx
/**
 * One-time migration: drop the orphaned AI deep research columns.
 *
 * The feature (OpenAI o4-mini-deep-research reports on a portfolio "Research"
 * tab) was removed in code on 2026-10-12. IRREVERSIBLE — destroys the stored
 * reports. Run only AFTER that code is deployed: the old api/portfolio.ts
 * selects these columns on every portfolio read.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/migrate-drop-deep-research.ts            # dry run (report only)
 *   source .env.local && npx tsx scripts/migrate-drop-deep-research.ts --confirm  # actually drop
 */

import pg from 'pg';

const COLUMNS = ['deep_research', 'deep_research_at'];

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('Error: SUPABASE_DB_URL must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const confirmed = process.argv.includes('--confirm');
  const client = new pg.Client({ connectionString: dbUrl });

  console.log('Connecting to database...');
  await client.connect();

  try {
    const existingCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'portfolios' AND column_name = ANY($1)
       ORDER BY column_name`,
      [COLUMNS]
    );
    const present = existingCols.rows.map((r) => r.column_name);

    console.log('\nportfolios columns present:', present.length ? present.join(', ') : '(none)');
    if (present.length) {
      const counts = await client.query(
        `SELECT ${present.map((c) => `count("${c}") AS "${c}"`).join(', ')} FROM portfolios`
      );
      console.log('  non-null values per column:', counts.rows[0]);
    }

    if (!confirmed) {
      console.log('\n[dry run] Nothing dropped. Re-run with --confirm to execute:');
      console.log('  ALTER TABLE portfolios');
      console.log(COLUMNS.map((c) => `    DROP COLUMN IF EXISTS ${c}`).join(',\n') + ';');
      await client.end();
      return;
    }

    console.log('\n--confirm set — dropping...');
    await client.query(
      `ALTER TABLE portfolios\n` +
        COLUMNS.map((c) => `  DROP COLUMN IF EXISTS ${c}`).join(',\n')
    );

    const leftover = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'portfolios' AND column_name = ANY($1)`,
      [COLUMNS]
    );
    console.log('\nVerification:');
    console.log('  remaining target columns:', leftover.rowCount === 0 ? 'none ✓' : leftover.rows);
    console.log('\nMigration successful!');

    await client.end();
  } catch (error) {
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }
}

main();
