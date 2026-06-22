/**
 * Adds share-link attribution to analytics_events so the Analytics Dashboard can
 * surface per-share-link access on the "Shared Link Access" panel.
 *
 * - share_link_id: nullable uuid, the share_links row a view came through (null =
 *   organic/anonymous/logged-in view, i.e. not via a share link).
 * - Partial index for the dashboard aggregation, which scans only attributed rows.
 *
 * Idempotent. Run: source .env.local && npx tsx scripts/migrate-analytics-share-link.ts
 */
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();

await client.query(
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS share_link_id uuid'
);
await client.query(
  `CREATE INDEX IF NOT EXISTS idx_analytics_events_share_link_id
   ON analytics_events (share_link_id) WHERE share_link_id IS NOT NULL`
);

const { rows } = await client.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'analytics_events' AND column_name = 'share_link_id'`
);
console.log('share_link_id column:', rows);

await client.end();
console.log('Migration complete.');
