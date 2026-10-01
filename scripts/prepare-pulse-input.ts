#!/usr/bin/env npx tsx
/**
 * Market pulse — gate + deterministic input for scripts/generate-pulse.sh.
 *
 * Gate: exits 10 (wrapper treats as "skip") outside the generation window —
 * trading days from 60 min before the open through 30 min after the close
 * (early-close aware, via isMarketOpen's NYSE calendar). The crontab fires at
 * :00/:30 every weekday, so that yields 8:30, 9:00, … 16:30 ET (13:30 on half
 * days). --force bypasses it.
 *
 * Input: writes scripts/pulse-output/input.json — index / futures / rates /
 * commodity quotes straight from Yahoo, plus today's earlier pulses. The model
 * takes every number from this file and uses web search only for the *why*:
 * the prototype showed search-sourced figures disagreeing between two reads of
 * the same page.
 *
 * Usage:
 *   set -a; source .env.local; set +a && npx tsx scripts/prepare-pulse-input.ts [--force]
 */

import fs from 'fs';
import path from 'path';
import { getMultipleQuotes } from '../api/_lib/yahoo.js';
import { getMarketStatus, isMarketOpen } from '../api/_lib/cache.js';
import { getRecentMarketPulses } from '../api/_lib/db.js';

const OUT_PATH = 'scripts/pulse-output/input.json';
const SKIP_EXIT_CODE = 10;

const MINUTE = 60_000;

function inWindow(now: Date): boolean {
  // Open now, opening within the hour, or closed within the last half hour.
  // 31 not 30: cron fires a few seconds past :30, and close+30 must still pass.
  return (
    isMarketOpen(now) ||
    isMarketOpen(new Date(now.getTime() + 60 * MINUTE)) ||
    isMarketOpen(new Date(now.getTime() - 31 * MINUTE))
  );
}

// Yield indices quote the yield in percent; their move is reported in basis
// points rather than as a % of the yield.
const SYMBOLS: { symbol: string; label: string; kind: 'index' | 'future' | 'yield' | 'other' }[] = [
  { symbol: '^GSPC', label: 'S&P 500', kind: 'index' },
  { symbol: '^IXIC', label: 'Nasdaq Composite', kind: 'index' },
  { symbol: '^DJI', label: 'Dow Jones', kind: 'index' },
  { symbol: '^RUT', label: 'Russell 2000', kind: 'index' },
  { symbol: 'ES=F', label: 'S&P 500 futures', kind: 'future' },
  { symbol: 'NQ=F', label: 'Nasdaq 100 futures', kind: 'future' },
  { symbol: '^VIX', label: 'VIX', kind: 'other' },
  { symbol: '^TNX', label: '10-year Treasury yield', kind: 'yield' },
  { symbol: 'DX-Y.NYB', label: 'US dollar index', kind: 'other' },
  { symbol: 'CL=F', label: 'WTI crude', kind: 'other' },
  { symbol: 'GC=F', label: 'Gold', kind: 'other' },
  { symbol: 'BTC-USD', label: 'Bitcoin', kind: 'other' },
];

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function etTime(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function main(): Promise<void> {
  const now = new Date();
  if (!process.argv.includes('--force') && !inWindow(now)) {
    console.log(`[${now.toISOString()}] prepare-pulse: outside window, skipping`);
    process.exit(SKIP_EXIT_CODE);
  }

  const quotes = await getMultipleQuotes(SYMBOLS.map((s) => s.symbol));
  const market = SYMBOLS.flatMap(({ symbol, label, kind }) => {
    const q = quotes.get(symbol);
    if (!q) return [];
    return [{
      symbol,
      label,
      kind,
      price: round(q.currentPrice, 2),
      previousClose: round(q.previousClose, 2),
      ...(kind === 'yield'
        ? { changeBps: round((q.currentPrice - q.previousClose) * 100, 1) }
        : { changePercent: round(q.changePercent, 2) }),
      quoteTimeET: q.regularMarketTime ? etTime(new Date(q.regularMarketTime)) : null,
    }];
  });

  if (!market.some((m) => m.symbol === '^GSPC')) {
    throw new Error('No S&P 500 quote from Yahoo — refusing to generate a pulse without market data');
  }

  // Today's earlier pulses (newest first) so the next one can say what changed
  // instead of repeating itself. "Today" = the same ET calendar date.
  const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const earlier = (await getRecentMarketPulses(20))
    .filter((p) => new Date(p.generated_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === todayET)
    .map((p) => ({ at: etTime(new Date(p.generated_at)), headline: p.headline, body: p.body }));

  const input = {
    nowET: etTime(now),
    marketStatus: getMarketStatus(now),
    market,
    earlierPulsesToday: earlier,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(input, null, 2) + '\n');
  console.log(`[${now.toISOString()}] prepare-pulse: wrote ${OUT_PATH} (${market.length} quotes, ${earlier.length} earlier pulses, status=${input.marketStatus})`);
}

main().catch((err) => {
  console.error('prepare-pulse failed:', err);
  process.exit(1);
});
