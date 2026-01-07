// Migration script to add instrument_type column and backfill existing holdings
// Run: node migrate-instrument-types.mjs

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

// Static holding type mappings
function getStaticInstrumentType(ticker) {
  const lowerTicker = ticker.toLowerCase();
  if (lowerTicker.includes('cash') || lowerTicker.includes('savings') || lowerTicker.includes('checking') || lowerTicker === 'vmfxx') {
    return 'Cash';
  }
  if (lowerTicker.includes('real estate')) {
    return 'Real Estate';
  }
  if (lowerTicker.includes('crypto')) {
    return 'Crypto';
  }
  if (lowerTicker.includes('bonds')) {
    return 'Bonds';
  }
  return 'Other';
}

async function getSymbolInfo(symbol) {
  try {
    const response = await fetch(
      `${TWELVE_DATA_BASE_URL}/symbol_search?symbol=${encodeURIComponent(symbol)}`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      const exactMatch = data.data.find(
        (d) => d.symbol.toUpperCase() === symbol.toUpperCase()
      );
      const match = exactMatch || data.data[0];
      return {
        name: match.instrument_name || symbol,
        instrumentType: match.instrument_type || 'Other',
      };
    }

    return null;
  } catch (error) {
    console.error(`Error fetching symbol info for ${symbol}:`, error);
    return null;
  }
}

async function migrate() {
  console.log('Starting migration...\n');

  // Step 1: Check if column exists, add if not
  console.log('Step 1: Checking if instrument_type column exists...');
  const { data: testData, error: testError } = await supabase
    .from('holdings')
    .select('instrument_type')
    .limit(1);

  if (testError && testError.message.includes('instrument_type')) {
    console.log('Column does not exist. Please run this SQL in Supabase dashboard:');
    console.log('  ALTER TABLE holdings ADD COLUMN instrument_type TEXT;');
    console.log('\nThen run this script again.');
    return;
  }

  console.log('Column exists.\n');

  // Step 2: Get all holdings without instrument_type
  console.log('Step 2: Fetching holdings without instrument_type...');
  const { data: holdings, error: fetchError } = await supabase
    .from('holdings')
    .select('*')
    .or('instrument_type.is.null,instrument_type.eq.');

  if (fetchError) {
    console.error('Error fetching holdings:', fetchError);
    return;
  }

  console.log(`Found ${holdings.length} holdings to update.\n`);

  if (holdings.length === 0) {
    console.log('All holdings already have instrument_type set. Migration complete!');
    return;
  }

  // Step 3: Update each holding
  console.log('Step 3: Updating holdings...\n');

  for (const holding of holdings) {
    let instrumentType;

    if (holding.is_static) {
      instrumentType = getStaticInstrumentType(holding.ticker);
      console.log(`  ${holding.ticker}: ${instrumentType} (static)`);
    } else {
      const symbolInfo = await getSymbolInfo(holding.ticker);
      instrumentType = symbolInfo?.instrumentType || 'Other';
      console.log(`  ${holding.ticker}: ${instrumentType} (from API)`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const { error: updateError } = await supabase
      .from('holdings')
      .update({ instrument_type: instrumentType })
      .eq('portfolio_id', holding.portfolio_id)
      .eq('ticker', holding.ticker);

    if (updateError) {
      console.error(`  Error updating ${holding.ticker}:`, updateError);
    }
  }

  console.log('\nMigration complete!');
}

migrate().catch(console.error);
