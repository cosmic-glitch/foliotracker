#!/usr/bin/env npx tsx
/**
 * Emits two JSON files used by the daily Claude news-generator session:
 *
 *   scripts/news-output/tickers.json
 *     Unique single-stock tickers across ALL portfolios (Common Stock, ADR).
 *
 *   scripts/news-output/etf-tickers.json
 *     ETF / Mutual Fund tickers from a single pilot portfolio (currently
 *     `baxter`). Generation cost is the gate — once the ETF prompt is
 *     trusted, lift this filter to all portfolios.
 *
 * Each entry carries an `already_generated_today` flag so the generator can
 * skip tickers whose summary for today is already cached.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/prepare-news-input.ts
 *     [--stocks-out scripts/news-output/tickers.json]
 *     [--etfs-out scripts/news-output/etf-tickers.json]
 */

import fs from 'fs';
import path from 'path';
import { supabase } from '../api/_lib/db.js';

const STOCK_INSTRUMENT_TYPES = ['Common Stock', 'American Depositary Receipt'];
const ETF_INSTRUMENT_TYPES = ['ETF', 'Mutual Fund'];

// Pilot gate: only this portfolio's ETFs/MFs get news generated for now.
const ETF_NEWS_PILOT_PORTFOLIO_IDS = ['baxter'];

interface TickerInput {
  ticker: string;
  name: string;
  already_generated_today: boolean;
}

function parseArgs(): { stocksOut: string; etfsOut: string } {
  const args = process.argv.slice(2);
  const defaults = {
    stocksOut: 'scripts/news-output/tickers.json',
    etfsOut: 'scripts/news-output/etf-tickers.json',
  };
  let stocksOut = defaults.stocksOut;
  let etfsOut = defaults.etfsOut;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stocks-out' && args[i + 1]) {
      stocksOut = args[++i];
    } else if (args[i] === '--etfs-out' && args[i + 1]) {
      etfsOut = args[++i];
    }
  }
  return { stocksOut, etfsOut };
}

async function buildInputs(
  instrumentTypes: string[],
  portfolioIds: string[] | null
): Promise<TickerInput[]> {
  let query = supabase
    .from('holdings')
    .select('ticker, name, instrument_type, is_static, portfolio_id')
    .in('instrument_type', instrumentTypes)
    .eq('is_static', false);

  if (portfolioIds !== null) {
    query = query.in('portfolio_id', portfolioIds);
  }

  const { data: holdings, error: hErr } = await query;
  if (hErr) {
    throw new Error(`Failed to read holdings: ${hErr.message}`);
  }

  const tickerMap = new Map<string, string>();
  for (const h of holdings || []) {
    const t = (h.ticker || '').toUpperCase();
    if (!t) continue;
    if (!tickerMap.has(t)) {
      tickerMap.set(t, h.name || t);
    }
  }

  const tickers = Array.from(tickerMap.keys()).sort();
  if (tickers.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];
  const { data: existing, error: eErr } = await supabase
    .from('ticker_news_summaries')
    .select('ticker')
    .in('ticker', tickers)
    .eq('summary_date', today);

  if (eErr) {
    throw new Error(`Failed to read existing summaries: ${eErr.message}`);
  }

  const doneToday = new Set<string>((existing || []).map((r) => r.ticker));

  return tickers.map((t) => ({
    ticker: t,
    name: tickerMap.get(t)!,
    already_generated_today: doneToday.has(t),
  }));
}

function writeOutput(filePath: string, rows: TickerInput[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2) + '\n');
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const { stocksOut, etfsOut } = parseArgs();

  const stocks = await buildInputs(STOCK_INSTRUMENT_TYPES, null);
  writeOutput(stocksOut, stocks);

  const etfs = await buildInputs(ETF_INSTRUMENT_TYPES, ETF_NEWS_PILOT_PORTFOLIO_IDS);
  writeOutput(etfsOut, etfs);

  const pending = (rows: TickerInput[]) => rows.filter((r) => !r.already_generated_today).length;
  console.error(
    `prepare-news-input: stocks=${stocks.length} (${pending(stocks)} pending), ` +
      `etfs=${etfs.length} (${pending(etfs)} pending) — pilot portfolios: ${ETF_NEWS_PILOT_PORTFOLIO_IDS.join(',')}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
