import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Connected to database');

  await client.query(`
    ALTER TABLE portfolio_snapshots
    ADD COLUMN IF NOT EXISTS regular_history_1d_json JSONB;
  `);
  console.log('Added regular_history_1d_json column to portfolio_snapshots');

  await client.end();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
