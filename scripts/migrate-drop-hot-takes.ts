#!/usr/bin/env npx tsx
/**
 * One-time migration: drop the orphaned "AI hot takes / personas / chat" schema.
 *
 * The feature was removed in code (commit 8616661, 2026-06-13) but the DB objects
 * were intentionally left in place. This drops them. IRREVERSIBLE — destroys the
 * stored hot_take / buffett_comment / munger_comment content.
 *
 * Objects dropped:
 *   portfolios columns: hot_take, hot_take_at, buffett_comment, buffett_comment_at,
 *                       munger_comment, munger_comment_at
 *   table:              portfolio_chats (DROP TABLE also removes its 3 indexes + FK)
 *
 * Note: scripts/migrate-ai-chat.sql only ever created hot_take/hot_take_at and
 * portfolio_chats — the buffett and munger columns were added out-of-band, so this
 * script is the only record that they existed.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/migrate-drop-hot-takes.ts            # dry run (report only)
 *   source .env.local && npx tsx scripts/migrate-drop-hot-takes.ts --confirm  # actually drop
 */

import pg from 'pg';

const COLUMNS = [
  'hot_take',
  'hot_take_at',
  'buffett_comment',
  'buffett_comment_at',
  'munger_comment',
  'munger_comment_at',
];

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
    // --- Report current state (and capture what's about to be destroyed) ---
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

    const chatsReg = await client.query(`SELECT to_regclass('public.portfolio_chats') AS t`);
    const chatsExists = chatsReg.rows[0].t !== null;
    let chatRows = 0;
    if (chatsExists) {
      const r = await client.query(`SELECT count(*)::int AS n FROM portfolio_chats`);
      chatRows = r.rows[0].n;
    }
    console.log(`portfolio_chats table: ${chatsExists ? `present (${chatRows} rows)` : 'absent'}`);

    if (!confirmed) {
      console.log('\n[dry run] Nothing dropped. Re-run with --confirm to execute:');
      console.log('  ALTER TABLE portfolios');
      console.log(COLUMNS.map((c) => `    DROP COLUMN IF EXISTS ${c}`).join(',\n') + ';');
      console.log('  DROP TABLE IF EXISTS portfolio_chats;');
      await client.end();
      return;
    }

    // --- Execute the drop in a single transaction ---
    console.log('\n--confirm set — dropping in a transaction...');
    await client.query('BEGIN');
    await client.query(
      `ALTER TABLE portfolios\n` +
        COLUMNS.map((c) => `  DROP COLUMN IF EXISTS ${c}`).join(',\n')
    );
    console.log('  Dropped 6 portfolios columns');
    await client.query('DROP TABLE IF EXISTS portfolio_chats');
    console.log('  Dropped portfolio_chats table (and its indexes + FK)');
    await client.query('COMMIT');

    // --- Verify ---
    const leftoverCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'portfolios' AND column_name = ANY($1)`,
      [COLUMNS]
    );
    const leftoverTable = await client.query(`SELECT to_regclass('public.portfolio_chats') AS t`);
    console.log('\nVerification:');
    console.log('  remaining target columns:', leftoverCols.rowCount === 0 ? 'none ✓' : leftoverCols.rows);
    console.log('  portfolio_chats:', leftoverTable.rows[0].t === null ? 'gone ✓' : 'STILL PRESENT ✗');
    console.log('\nMigration successful!');

    await client.end();
  } catch (error) {
    console.error('Migration failed:', error);
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    await client.end();
    process.exit(1);
  }
}

main();
