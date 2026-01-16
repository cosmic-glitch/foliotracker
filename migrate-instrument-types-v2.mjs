// Migration script to re-classify instrument_type for existing holdings
// Uses FMP API with isEtf/isFund flags for accurate classification
// Run: node migrate-instrument-types-v2.mjs

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables (check multiple files)
config({ path: '.env.local' });
config({ path: '.env.pulled' });
config(); // Also load .env as fallback

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_STABLE_URL = 'https://financialmodelingprep.com/stable';

if (!FMP_API_KEY) {
  console.error('FMP_API_KEY not found in environment variables');
  process.exit(1);
}

// Infer instrument type from FMP profile data (same logic as api/lib/fmp.ts)
function inferInstrumentType(name, isEtf, isFund) {
  const nameLower = name.toLowerCase();
  const isBondFund = nameLower.includes('bond') ||
                     nameLower.includes('treasury') ||
                     nameLower.includes('fixed income') ||
                     nameLower.includes('aggregate');

  if (isEtf) {
    return isBondFund ? 'Bond ETF' : 'ETF';
  }
  if (isFund) {
    return isBondFund ? 'Bond Mutual Fund' : 'Mutual Fund';
  }
  return 'Common Stock';
}

async function getSymbolInfo(symbol) {
  try {
    const response = await fetch(
      `${FMP_STABLE_URL}/profile?symbol=${symbol}&apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
      console.warn(`  API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const profile = data[0];
    const name = profile.companyName || symbol;
    return {
      name,
      instrumentType: inferInstrumentType(name, profile.isEtf, profile.isFund),
      isEtf: profile.isEtf,
      isFund: profile.isFund,
    };
  } catch (error) {
    console.error(`  Error fetching symbol info for ${symbol}:`, error.message);
    return null;
  }
}

async function migrate() {
  console.log('Starting instrument type re-classification...\n');

  // Get all tradeable holdings (non-static)
  console.log('Fetching all tradeable holdings...');
  const { data: holdings, error: fetchError } = await supabase
    .from('holdings')
    .select('*')
    .eq('is_static', false);

  if (fetchError) {
    console.error('Error fetching holdings:', fetchError);
    return;
  }

  console.log(`Found ${holdings.length} tradeable holdings to check.\n`);

  if (holdings.length === 0) {
    console.log('No tradeable holdings found. Migration complete!');
    return;
  }

  // Track changes
  const changes = [];
  const errors = [];

  // Update each holding
  console.log('Checking and updating holdings...\n');

  for (const holding of holdings) {
    const symbolInfo = await getSymbolInfo(holding.ticker);

    if (!symbolInfo) {
      console.log(`  ${holding.ticker}: Could not fetch info, skipping`);
      errors.push(holding.ticker);
      continue;
    }

    const oldType = holding.instrument_type || 'null';
    const newType = symbolInfo.instrumentType;

    if (oldType !== newType) {
      console.log(`  ${holding.ticker}: ${oldType} -> ${newType} (isEtf=${symbolInfo.isEtf}, isFund=${symbolInfo.isFund})`);

      const { error: updateError } = await supabase
        .from('holdings')
        .update({ instrument_type: newType })
        .eq('portfolio_id', holding.portfolio_id)
        .eq('ticker', holding.ticker);

      if (updateError) {
        console.error(`    Error updating ${holding.ticker}:`, updateError);
        errors.push(holding.ticker);
      } else {
        changes.push({ ticker: holding.ticker, from: oldType, to: newType });
      }
    } else {
      console.log(`  ${holding.ticker}: ${oldType} (unchanged)`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total holdings checked: ${holdings.length}`);
  console.log(`Holdings updated: ${changes.length}`);
  console.log(`Errors: ${errors.length}`);

  if (changes.length > 0) {
    console.log('\nChanges made:');
    for (const change of changes) {
      console.log(`  ${change.ticker}: ${change.from} -> ${change.to}`);
    }
  }

  if (errors.length > 0) {
    console.log('\nFailed tickers:', errors.join(', '));
  }

  console.log('\nMigration complete!');
  console.log('Note: Run a snapshot refresh to update the portfolio views.');
}

migrate().catch(console.error);
