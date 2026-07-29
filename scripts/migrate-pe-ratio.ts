// One-time migration: add trailing P/E to fundamentals_cache.
// Run: source .env.local && npx tsx scripts/migrate-pe-ratio.ts
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();
await client.query(
  'ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS pe_ratio double precision'
);
console.log('fundamentals_cache.pe_ratio added');
await client.end();
