import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  await client.connect();
  console.log('Connected to database');

  await client.query(`
    ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS operating_margin DOUBLE PRECISION;
    ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS revenue_growth_3y DOUBLE PRECISION;
    ALTER TABLE fundamentals_cache ADD COLUMN IF NOT EXISTS eps_growth_3y DOUBLE PRECISION;
  `);
  console.log('Added columns: operating_margin, revenue_growth_3y, eps_growth_3y');

  await client.end();
  console.log('Done');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
