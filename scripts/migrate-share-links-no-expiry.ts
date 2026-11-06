#!/usr/bin/env npx tsx
/**
 * Share links stop expiring — they last until the owner deletes them.
 * Mirrors supabase/migrations/016: drops NOT NULL on expires_at, marks
 * already-expired links revoked (so they stay dead), and clears the expiry on
 * every other live link. Also drops the touched links' Redis auth-cache
 * entries so no cached row outlives the change. Idempotent.
 *
 * Run only once code that treats a null expires_at as "never" is deployed:
 * older code reads null as the epoch and would reject every live link.
 *
 *   set -a; source .env.local; set +a && npx tsx scripts/migrate-share-links-no-expiry.ts
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
  await client.connect();

  const touched: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE share_links ALTER COLUMN expires_at DROP NOT NULL');

    const revoked = await client.query<{ token: string; portfolio_id: string; label: string | null }>(`
      UPDATE share_links
         SET revoked_at = expires_at
       WHERE revoked_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= now()
      RETURNING token, portfolio_id, label
    `);
    console.log(`Marked ${revoked.rowCount} expired link(s) revoked:`);
    for (const r of revoked.rows) console.log(`  ${r.portfolio_id}: ${r.label ?? '(no label)'}`);

    const cleared = await client.query<{ token: string; portfolio_id: string; label: string | null }>(`
      UPDATE share_links
         SET expires_at = NULL
       WHERE revoked_at IS NULL
         AND expires_at IS NOT NULL
      RETURNING token, portfolio_id, label
    `);
    console.log(`Cleared expiry on ${cleared.rowCount} live link(s):`);
    for (const r of cleared.rows) console.log(`  ${r.portfolio_id}: ${r.label ?? '(no label)'}`);

    await client.query('COMMIT');
    touched.push(...revoked.rows.map((r) => r.token), ...cleared.rows.map((r) => r.token));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }

  const remaining = await client.query(`
    SELECT count(*)::int AS n FROM share_links WHERE revoked_at IS NULL AND expires_at IS NOT NULL
  `);
  await client.end();
  if (remaining.rows[0].n !== 0) {
    console.error(`Verification failed: ${remaining.rows[0].n} live link(s) still have an expiry`);
    process.exit(1);
  }

  // Imported late so the env check above runs before redis.ts builds its client.
  const { deleteAuthCache } = await import('../api/_lib/redis.js');
  await deleteAuthCache('share_link', touched);
  console.log(`Dropped ${touched.length} auth-cache entr${touched.length === 1 ? 'y' : 'ies'}.`);
  console.log('Migration successful!');
}

main();
