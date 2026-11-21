// Trade-aware day change.
//
// The naive day change prices today's holdings as if they had been held since
// the previous close: shares × (price − previousClose). On a day with a swap
// that charges newly bought shares with the whole day's move (even though they
// were bought partway through it) and drops the move of whatever was sold.
//
// Instead, each holding's day change is
//
//   value − dayBaseValue − dayFlow
//
//   dayBaseValue  what was held at the previous close, priced at that close
//                 (shares before today's edits × previousClose; for a static
//                 holding its value before today's edits)
//   dayFlow       money moved into (+) / out of (−) the line by today's edits:
//                 Σ Δshares × tradePrice, or Δstatic_value for static rows
//
// so new money (a deposit, a newly tracked account, a static revaluation) never
// reads as a gain or loss, and a swap reads as what actually happened. The
// portfolio % divides by Σ(dayBaseValue + dayFlowWeighted) — a Modified Dietz
// denominator, where each flow counts for the fraction of the regular session
// left after it (0 for after-hours edits), so a large mid-session deposit
// doesn't get credited with the whole day.
//
// "Today's edits" are holdings_history rows recorded since the regular open of
// the session the day change describes (getCurrentTradingSessionRange): Friday
// evening and weekend edits belong to Friday; edits made before an open set
// that session's starting holdings, as before. tradePrice is the owner's
// price_override, else the 1-minute bar at the edit time when it was made
// during the regular session, else the regular-session price (the close, once
// the session is over) — so an edit logged after the close counts as a trade
// at the close.
//
// Lines sold out today (no longer in holdings) live in the snapshot's
// day_closed_json so their move up to the sale still counts in the totals.
//
// Consumers that re-derive the day change (usePortfolioData's regular-hours
// recompute, api/portfolios.ts's landing totals, App.tsx's 1D chart base) read
// the optional dayBaseValue / dayFlow / dayFlowWeighted fields with a default
// of "held since the previous close" — see holdingDayBase below.

import { createETDate, getCurrentTradingSessionRange, getRegularCloseTime } from './cache.js';
import { supabase, type DbHolding, type DbHoldingsHistory } from './db.js';

export interface DayFlowFields {
  dayBaseValue: number;
  dayFlow: number;
  dayFlowWeighted: number;
}

// One edit, resolved to the amounts the day change needs.
export interface DayTrade {
  // When the trade counts as having happened (epoch ms): the edit time, or the
  // regular close for an edit made after it — matching the close fallback for
  // its price, and keeping the 1D chart's last point on the current value.
  at: number;
  deltaShares: number; // tradeable rows; 0 for static
  flow: number; // Δshares × tradePrice, or Δstatic_value
  weight: number; // fraction of the regular session left after the edit
}

// Per (ticker, kind) aggregate of today's edits.
export interface DayEdits {
  ticker: string;
  name: string;
  isStatic: boolean;
  // Shares (tradeable) or value (static) before the first edit today.
  base: number;
  // Shares / value after the last edit today.
  final: number;
  removed: boolean;
  trades: DayTrade[];
}

export interface ClosedTodayLine extends DayFlowFields {
  ticker: string;
  name: string;
  isStatic: boolean;
  baseShares: number;
  previousClose: number;
  dayChange: number;
}

export interface TradeWindow {
  start: number; // regular open of the session the day change describes
  regularOpen: number;
  regularClose: number;
}

export function getTradeWindow(now: Date = new Date()): TradeWindow {
  const { tradingDate } = getCurrentTradingSessionRange(now);
  const regularOpen = createETDate(tradingDate, 9, 30).getTime();
  return {
    start: regularOpen,
    regularOpen,
    regularClose: getRegularCloseTime(tradingDate).getTime(),
  };
}

const key = (ticker: string, isStatic: boolean) => `${isStatic ? 's' : 't'}:${ticker}`;

// All portfolios' holdings_history rows since the window start, grouped by
// portfolio. Best-effort: an error degrades to "no edits today" (the naive
// day change), never a failed snapshot.
export async function getTodaysHoldingsEdits(
  window: TradeWindow,
  portfolioId?: string,
): Promise<Map<string, DbHoldingsHistory[]>> {
  const out = new Map<string, DbHoldingsHistory[]>();
  try {
    let query = supabase
      .from('holdings_history')
      .select('*')
      .gte('recorded_at', new Date(window.start).toISOString())
      .order('recorded_at', { ascending: true });
    if (portfolioId) query = query.eq('portfolio_id', portfolioId.toLowerCase());
    const { data, error } = await query;
    if (error) throw error;
    for (const row of (data || []) as DbHoldingsHistory[]) {
      const list = out.get(row.portfolio_id) ?? [];
      list.push(row);
      out.set(row.portfolio_id, list);
    }
  } catch (e) {
    console.warn('[day-flows] could not read today\'s holdings edits; using naive day change:', e);
  }
  return out;
}

// Tickers sold out today (tradeable, in today's edits, not in holdings) — the
// refresh must quote them so their move up to the sale can be priced.
export function closedTodayTickers(rows: DbHoldingsHistory[], holdings: DbHolding[]): string[] {
  const held = new Set(holdings.filter((h) => !h.is_static).map((h) => h.ticker));
  const out = new Set<string>();
  for (const r of rows) if (!r.is_static && !held.has(r.ticker)) out.add(r.ticker);
  return [...out];
}

// Last 1-minute close at or before `at`, restricted to the regular session.
function barPriceAt(
  bars: Array<{ date: string; close: number }> | undefined,
  at: number,
  window: TradeWindow,
): number | null {
  if (!bars) return null;
  let best: number | null = null;
  for (const b of bars) {
    const t = Date.parse(b.date);
    if (t > at) break;
    if (t >= window.regularOpen && t < window.regularClose && b.close > 0) best = b.close;
  }
  return best;
}

export function resolveDayEdits(
  rows: DbHoldingsHistory[],
  window: TradeWindow,
  regularPrices: Map<string, { currentPrice: number }>,
  intradayPrices: Map<string, Array<{ date: string; close: number }>>,
): Map<string, DayEdits> {
  const out = new Map<string, DayEdits>();
  const session = window.regularClose - window.regularOpen;
  for (const r of rows) {
    const at = Date.parse(r.recorded_at);
    const k = key(r.ticker, r.is_static);
    const removed = r.change_type === 'removed';
    const weight = at < window.regularClose
      ? Math.min(1, (window.regularClose - Math.max(at, window.regularOpen)) / session)
      : 0;

    let before: number;
    let after: number;
    let flow: number;
    let deltaShares = 0;
    if (r.is_static) {
      before = r.change_type === 'added' ? 0 : Number(r.prev_static_value ?? r.static_value ?? 0);
      after = removed ? 0 : Number(r.static_value ?? 0);
      flow = after - before;
    } else {
      before = Number(r.prev_shares ?? 0);
      after = removed ? 0 : Number(r.shares);
      deltaShares = after - before;
      const override = r.price_override != null ? Number(r.price_override) : null;
      const inSession = at >= window.regularOpen && at < window.regularClose;
      const tradePrice = (override && override > 0 ? override : null)
        ?? (inSession ? barPriceAt(intradayPrices.get(r.ticker), at, window) : null)
        ?? regularPrices.get(r.ticker)?.currentPrice
        ?? null;
      if (tradePrice == null) continue; // unpriceable — leave it to the naive math
      flow = deltaShares * tradePrice;
    }

    const trade: DayTrade = { at: Math.min(at, window.regularClose), deltaShares, flow, weight };
    const existing = out.get(k);
    if (existing) {
      existing.final = after;
      existing.removed = removed;
      existing.name = r.name;
      existing.trades.push(trade);
    } else {
      out.set(k, {
        ticker: r.ticker,
        name: r.name,
        isStatic: r.is_static,
        base: before,
        final: after,
        removed,
        trades: [trade],
      });
    }
  }
  return out;
}

export function editsFor(edits: Map<string, DayEdits>, ticker: string, isStatic: boolean): DayEdits | undefined {
  return edits.get(key(ticker, isStatic));
}

// Day base of a snapshot holding, defaulting to "held since the previous
// close" for holdings without today's edits (and snapshots written before
// these fields existed). Mirrored in src/hooks/usePortfolioData.ts.
export function holdingDayBase(h: {
  isStatic: boolean;
  shares: number;
  previousClose: number;
  value: number;
  dayBaseValue?: unknown;
  dayFlow?: unknown;
  dayFlowWeighted?: unknown;
}): DayFlowFields {
  return {
    dayBaseValue: typeof h.dayBaseValue === 'number'
      ? h.dayBaseValue
      : (h.isStatic ? h.value : h.shares * h.previousClose),
    dayFlow: typeof h.dayFlow === 'number' ? h.dayFlow : 0,
    dayFlowWeighted: typeof h.dayFlowWeighted === 'number' ? h.dayFlowWeighted : 0,
  };
}

// Regular-session (or any price basis) day totals over snapshot holdings plus
// today's closed lines. `valueOf` gives a holding's value on the chosen basis.
export function dayTotals<H extends Parameters<typeof holdingDayBase>[0]>(
  holdings: H[],
  closed: ClosedTodayLine[] | null | undefined,
  valueOf: (h: H) => number,
): { value: number; dayChange: number; denominator: number; dayChangePercent: number } {
  let value = 0;
  let dayChange = 0;
  let denominator = 0;
  for (const h of holdings) {
    const v = valueOf(h);
    const b = holdingDayBase(h);
    value += v;
    dayChange += v - b.dayBaseValue - b.dayFlow;
    denominator += b.dayBaseValue + b.dayFlowWeighted;
  }
  for (const c of closed ?? []) {
    dayChange += c.dayChange;
    denominator += c.dayBaseValue + c.dayFlowWeighted;
  }
  return {
    value,
    dayChange,
    denominator,
    dayChangePercent: denominator > 0 ? (dayChange / denominator) * 100 : 0,
  };
}
