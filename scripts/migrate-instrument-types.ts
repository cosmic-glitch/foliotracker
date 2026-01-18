// scripts/migrate-instrument-types.ts
// One-time migration script to regenerate all instrument_types using Yahoo Finance API
//
// Usage:
//   source .env.local
//   npx tsx scripts/migrate-instrument-types.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as readline from 'readline';

let supabase: SupabaseClient;

function mapYahooInstrumentType(instrumentType: string | undefined, name: string): string {
  const nameLower = name.toLowerCase();

  // Check for money market funds first (by instrumentType or name starting with "cash")
  if (instrumentType === 'MONEYMARKET' || nameLower.startsWith('cash')) {
    return 'Money Market';
  }

  switch (instrumentType) {
    case 'EQUITY':
      return 'Common Stock';
    case 'ETF':
      return 'ETF';
    case 'MUTUALFUND':
      return 'Mutual Fund';
    case 'CRYPTOCURRENCY':
      return 'Crypto';
    default:
      return 'Other';
  }
}

async function getYahooInstrumentType(symbol: string): Promise<string | null> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!response.ok) return null;
  const data = await response.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const name = meta.longName || meta.shortName || symbol;
  return mapYahooInstrumentType(meta.instrumentType, name);
}

async function askConfirmation(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Get all unique tickers (non-static only)
  const { data: holdings, error } = await supabase
    .from('holdings')
    .select('ticker')
    .eq('is_static', false);

  if (error) {
    console.error('Database error:', error);
    process.exit(1);
  }

  // Get unique tickers
  const tickers = [...new Set((holdings || []).map((h) => h.ticker))];

  console.log(`Found ${tickers.length} unique tickers\n`);
  console.log('Fetching instrument types from Yahoo...\n');

  // Fetch correct types from Yahoo
  const updates: { ticker: string; newType: string }[] = [];
  const failures: string[] = [];

  for (const ticker of tickers) {
    const newType = await getYahooInstrumentType(ticker);
    if (newType) {
      updates.push({ ticker, newType });
    } else {
      failures.push(ticker);
    }
    // Rate limit - 100ms between requests
    await new Promise((r) => setTimeout(r, 100));
  }

  // Display results
  if (failures.length > 0) {
    console.log(`\nFailed to fetch (${failures.length}): ${failures.join(', ')}\n`);
  }

  if (updates.length === 0) {
    console.log('No tickers to update.');
    return;
  }

  console.log(`\nWill update ${updates.length} tickers:\n`);
  console.log('TICKER'.padEnd(10) + 'TYPE');
  console.log('-'.repeat(30));
  for (const { ticker, newType } of updates) {
    console.log(ticker.padEnd(10) + newType);
  }

  // Wait for confirmation
  console.log('');
  const confirmed = await askConfirmation('Apply these updates to ALL rows? (yes/no): ');

  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  // Apply updates - update ALL rows for each ticker
  console.log('\nApplying updates...');
  let success = 0;
  for (const { ticker, newType } of updates) {
    const { error: updateError } = await supabase
      .from('holdings')
      .update({ instrument_type: newType })
      .eq('ticker', ticker);

    if (updateError) {
      console.error(`Failed to update ${ticker}:`, updateError);
    } else {
      success++;
    }
  }

  console.log(`\nDone: ${success}/${updates.length} tickers updated successfully.`);
}

main().catch(console.error);
