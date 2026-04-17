#!/usr/bin/env npx tsx
/**
 * Emits, on stdout, a JSON array of unique single-stock tickers across all
 * portfolios, with an `already_generated_today` flag so the generator can skip
 * tickers whose summary for today is already cached.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/prepare-news-input.ts > scripts/news-output/tickers.json
 */

import { supabase } from '../api/_lib/db.js';

const ELIGIBLE_INSTRUMENT_TYPES = ['Common Stock', 'American Depositary Receipt'];

interface TickerInput {
  ticker: string;
  name: string;
  already_generated_today: boolean;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const { data: holdings, error: hErr } = await supabase
    .from('holdings')
    .select('ticker, name, instrument_type, is_static')
    .in('instrument_type', ELIGIBLE_INSTRUMENT_TYPES)
    .eq('is_static', false);

  if (hErr) {
    console.error('Failed to read holdings:', hErr);
    process.exit(1);
  }

  // Dedup by ticker, prefer the first encountered `name`.
  const tickerMap = new Map<string, string>();
  for (const h of holdings || []) {
    const t = (h.ticker || '').toUpperCase();
    if (!t) continue;
    if (!tickerMap.has(t)) {
      tickerMap.set(t, h.name || t);
    }
  }

  const tickers = Array.from(tickerMap.keys()).sort();
  if (tickers.length === 0) {
    process.stdout.write('[]\n');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: existing, error: eErr } = await supabase
    .from('ticker_news_summaries')
    .select('ticker')
    .in('ticker', tickers)
    .eq('summary_date', today);

  if (eErr) {
    console.error('Failed to read existing summaries:', eErr);
    process.exit(1);
  }

  const doneToday = new Set<string>((existing || []).map((r) => r.ticker));

  const output: TickerInput[] = tickers.map((t) => ({
    ticker: t,
    name: tickerMap.get(t)!,
    already_generated_today: doneToday.has(t),
  }));

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
