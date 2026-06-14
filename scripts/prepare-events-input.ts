#!/usr/bin/env npx tsx
/**
 * PROTOTYPE — Upcoming Events feature (not wired into the app).
 *
 * Emits the deterministic input the events generator consumes:
 *
 *   scripts/events-output/holdings.json
 *     The single-stock universe whose earnings dates are worth surfacing on
 *     the landing page: every Common Stock / ADR held by a *publicly visible*
 *     portfolio, with holder breadth. Visibility filter mirrors the movers
 *     strip (computeMarketMovers in api/portfolios.ts) — a name only counts if
 *     it is already public (visibility === 'public' OR allocation_public),
 *     so the landing page never leaks a private holding via an earnings event.
 *
 * Each entry carries the holders (portfolio handles + count) so the generator
 * can attach "held by AB, CD" the same way the movers strip does, and rank by
 * breadth when two earnings land on the same day.
 *
 * The macroeconomic calendar is intentionally NOT built here — it is universal
 * (not portfolio-specific), so the generator researches it live from the web.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/prepare-events-input.ts
 *     [--out scripts/events-output/holdings.json]
 */

import fs from 'fs';
import path from 'path';
import { supabase, getPortfolios } from '../api/_lib/db.js';

const STOCK_INSTRUMENT_TYPES = ['Common Stock', 'American Depositary Receipt'];

// Dual share classes count as one company (value side is canonical) — same
// aliasing the movers strip uses so we don't list GOOG and GOOGL twice.
const SHARE_CLASS_ALIASES: Record<string, string> = { GOOGL: 'GOOG' };

interface HoldingInput {
  ticker: string;
  name: string;
  // Portfolio handles that hold this name, in creation order (matches the
  // Users list + movers strip identity).
  holders: string[];
  holder_count: number;
}

function parseArgs(): { out: string } {
  const args = process.argv.slice(2);
  let out = 'scripts/events-output/holdings.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) out = args[++i];
  }
  return { out };
}

async function buildInput(): Promise<HoldingInput[]> {
  const portfolios = await getPortfolios();

  // Publicly-visible portfolios only (same gate as computeMarketMovers).
  const publicIds = portfolios
    .filter((p) => p.visibility === 'public' || (p.allocation_public ?? true))
    .map((p) => p.id);

  if (publicIds.length === 0) return [];

  const { data: holdings, error } = await supabase
    .from('holdings')
    .select('ticker, name, instrument_type, is_static, portfolio_id')
    .in('instrument_type', STOCK_INSTRUMENT_TYPES)
    .in('portfolio_id', publicIds)
    .eq('is_static', false);

  if (error) throw new Error(`Failed to read holdings: ${error.message}`);

  // ticker (canonical) -> { name, holders set in creation order }
  const order = new Map<string, number>(publicIds.map((id, i) => [id, i]));
  const byTicker = new Map<string, { name: string; holders: Set<string> }>();

  for (const h of holdings || []) {
    const raw = (h.ticker || '').toUpperCase();
    if (!raw) continue;
    const ticker = SHARE_CLASS_ALIASES[raw] ?? raw;
    let entry = byTicker.get(ticker);
    if (!entry) {
      entry = { name: h.name || ticker, holders: new Set() };
      byTicker.set(ticker, entry);
    }
    entry.holders.add(h.portfolio_id);
  }

  const rows: HoldingInput[] = Array.from(byTicker.entries()).map(([ticker, e]) => {
    const holders = Array.from(e.holders).sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );
    return { ticker, name: e.name, holders, holder_count: holders.length };
  });

  // Rank by breadth (most-held first) then ticker — the order the generator
  // should research and the order ties break on.
  rows.sort((a, b) => b.holder_count - a.holder_count || a.ticker.localeCompare(b.ticker));
  return rows;
}

function writeOutput(filePath: string, rows: HoldingInput[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2) + '\n');
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const { out } = parseArgs();
  const rows = await buildInput();
  writeOutput(out, rows);

  const totalHolders = rows.reduce((n, r) => n + r.holder_count, 0);
  console.error(
    `prepare-events-input: ${rows.length} unique held stocks across public portfolios ` +
      `(${totalHolders} holder-links). Top: ${rows.slice(0, 8).map((r) => `${r.ticker}×${r.holder_count}`).join(', ')}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
