#!/usr/bin/env npx tsx
/**
 * Market pulse — gate + deterministic input for scripts/generate-pulse.sh.
 *
 * Gate: exits 10 (wrapper treats as "skip") outside the generation window —
 * trading days from 60 min before the open through 30 min after the close
 * (early-close aware, via isMarketOpen's NYSE calendar). The crontab fires at
 * :05/:35 every weekday, so that yields 8:35, 9:05, … 16:05 ET (13:05 on half
 * days) — five past, so the close edition sees settled closing prints and the
 * 8:30/10:00 data releases are already out. --force bypasses it.
 *
 * Input: writes scripts/pulse-output/input.json — index / futures / rates /
 * commodity quotes straight from Yahoo, the landing page's movers strip (the
 * big moves in names this group holds), Yahoo headlines for those movers, plus
 * today's earlier pulses. The model takes every number from this file and uses
 * the headlines and web search only for the *why*: the prototype showed
 * search-sourced figures disagreeing between two reads of the same page.
 *
 * Usage:
 *   set -a; source .env.local; set +a && npx tsx scripts/prepare-pulse-input.ts [--force]
 */

import fs from 'fs';
import path from 'path';
import { getMultipleQuotes, getTickerNews } from '../api/_lib/yahoo.js';
import { getMarketStatus, getPreviousSessionClose, isMarketOpen } from '../api/_lib/cache.js';
import { getRecentMarketPulses } from '../api/_lib/db.js';

const OUT_PATH = 'scripts/pulse-output/input.json';
const SKIP_EXIT_CODE = 10;
// The landing page's own payload, so the pulse talks about the same movers the
// strip beside it shows (computeMarketMovers in api/portfolios.ts).
const MOVERS_URL = 'https://foliotracker.pro/api/portfolios';

const MINUTE = 60_000;

function inWindow(now: Date): boolean {
  // Open now, opening within the hour, or closed within the last half hour.
  return (
    isMarketOpen(now) ||
    isMarketOpen(new Date(now.getTime() + 60 * MINUTE)) ||
    isMarketOpen(new Date(now.getTime() - 30 * MINUTE))
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

interface ApiMover {
  ticker: string;
  name: string;
  changePercent: number;
  holders: string[];
}

// Best-effort: a down API shouldn't cost the pulse, just its stock angle.
async function fetchMovers(): Promise<{
  regularSession: { ticker: string; name: string; changePercent: number; heldBy: number }[];
  extendedHours: { ticker: string; name: string; changePercent: number; heldBy: number }[] | null;
}> {
  const shape = (ms: ApiMover[]) =>
    ms.map((m) => ({
      ticker: m.ticker,
      name: m.name,
      changePercent: round(m.changePercent, 2),
      heldBy: m.holders.length,
    }));
  try {
    const res = await fetch(MOVERS_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { movers } = await res.json();
    return {
      regularSession: shape(movers.regular),
      // `extended` is only its own ranking when extendedBasis says so; otherwise
      // it's a copy of `regular`.
      extendedHours: movers.extendedBasis === 'extended-only' ? shape(movers.extended) : null,
    };
  } catch (err) {
    console.warn(`prepare-pulse: movers fetch failed (${err instanceof Error ? err.message : err}); continuing without`);
    return { regularSession: [], extendedHours: null };
  }
}

// Headlines per mover, published since the last regular close, so the model
// gets the "why" with a trustworthy date attached. Web search alone kept missing
// these: results are undated titles, and the matching pages were often
// paywalled or showed no date, so rule 3 dropped the stock. Kept: articles whose
// main subject is the ticker, or whose title names it ("…; Broadcom Rises" in a
// TSMC story). Best-effort per ticker.
const NEWS_TICKERS_MAX = 8;
const NEWS_PER_TICKER = 5;

async function fetchMoverNews(
  movers: { ticker: string; name: string }[],
  since: Date,
): Promise<Record<string, { publishedET: string; publisher: string; title: string; url: string }[]>> {
  const unique = [...new Map(movers.map((m) => [m.ticker, m])).values()].slice(0, NEWS_TICKERS_MAX);
  const entries = await Promise.all(unique.map(async ({ ticker, name }) => {
    // Company name case-insensitively ("NVIDIA" vs "Nvidia"); the ticker only
    // as written, so APP doesn't match "app".
    const word = (w: string, flags = '') => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags);
    const firstWord = name.replace(/^The\s+/, '').split(/[\s,.]+/)[0];
    const named = (title: string) => word(ticker).test(title) || (firstWord.length > 2 && word(firstWord, 'i').test(title));
    try {
      const items = (await getTickerNews(ticker))
        .filter((a) => a.publishedAt >= since && (a.relatedTickers[0] === ticker || named(a.title)))
        .slice(0, NEWS_PER_TICKER)
        .map((a) => ({ publishedET: etTime(a.publishedAt), publisher: a.publisher, title: a.title, url: a.link }));
      return [ticker, items] as const;
    } catch (err) {
      console.warn(`prepare-pulse: news fetch for ${ticker} failed (${err instanceof Error ? err.message : err})`);
      return [ticker, []] as const;
    }
  }));
  return Object.fromEntries(entries.filter(([, items]) => items.length));
}

async function main(): Promise<void> {
  const now = new Date();
  if (!process.argv.includes('--force') && !inWindow(now)) {
    console.log(`[${now.toISOString()}] prepare-pulse: outside window, skipping`);
    process.exit(SKIP_EXIT_CODE);
  }

  const [quotes, movers] = await Promise.all([
    getMultipleQuotes(SYMBOLS.map((s) => s.symbol)),
    fetchMovers(),
  ]);
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

  const moverNews = await fetchMoverNews(
    [...(movers.extendedHours ?? []), ...movers.regularSession],
    getPreviousSessionClose(now),
  );

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
    movers,
    moverNews,
    earlierPulsesToday: earlier,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(input, null, 2) + '\n');
  console.log(`[${now.toISOString()}] prepare-pulse: wrote ${OUT_PATH} (${market.length} quotes, ${movers.regularSession.length} movers, ${Object.keys(moverNews).length} with news, ${earlier.length} earlier pulses, status=${input.marketStatus})`);
}

main().catch((err) => {
  console.error('prepare-pulse failed:', err);
  process.exit(1);
});
