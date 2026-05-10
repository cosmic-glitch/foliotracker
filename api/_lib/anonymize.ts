/**
 * Helpers for the `allocation_only` share-link mode.
 *
 * The goal: a viewer of an `allocation_only` share link must not be able to
 * recover the owner's wealth, share counts, or absolute gains/losses from the
 * API responses. We strip all dollar-denominated fields and convert the
 * historical chart series to a normalized index (start = 100, later points
 * are `(value / firstValue) * 100`).
 *
 * `allocation` (a percentage, already computed by the snapshot pipeline) is
 * preserved so the frontend can render the existing AllocationView without
 * needing per-holding dollar values.
 */

interface AnyHolding {
  ticker: string;
  name: string;
  allocation: number;
  dayChangePercent: number;
  profitLossPercent: number | null;
  instrumentType: string;
  isStatic: boolean;
  // Anything else may be present on input — stripped on output.
  [k: string]: unknown;
}

interface PortfolioResponseLike {
  holdings?: AnyHolding[];
  totalValue?: number;
  totalDayChange?: number;
  totalDayChangePercent?: number;
  totalGain?: number | null;
  totalGainPercent?: number | null;
  hotTake?: string | null;
  hotTakeAt?: string | null;
  buffettComment?: string | null;
  buffettCommentAt?: string | null;
  mungerComment?: string | null;
  mungerCommentAt?: string | null;
  deepResearch?: string | null;
  deepResearchAt?: string | null;
  [k: string]: unknown;
}

interface HistoryPoint {
  date: string;
  value: number;
}

/**
 * Strip dollar/share-bearing fields from a portfolio response and tag it
 * with `viewMode: 'allocation_only'`. Mutates a shallow copy — callers can
 * pass the original response object.
 */
export function stripPortfolioForAllocationOnly<T extends PortfolioResponseLike>(
  response: T
): T & { viewMode: 'allocation_only' } {
  const stripped: Record<string, unknown> = { ...response };

  // Top-level absolute amounts → zero/null.
  stripped.totalValue = 0;
  stripped.totalDayChange = 0;
  stripped.totalGain = null;
  // Keep totalDayChangePercent and totalGainPercent — they're percentages.

  // AI commentary tends to mention dollar amounts, so suppress it entirely.
  stripped.hotTake = null;
  stripped.hotTakeAt = null;
  stripped.buffettComment = null;
  stripped.buffettCommentAt = null;
  stripped.mungerComment = null;
  stripped.mungerCommentAt = null;
  stripped.deepResearch = null;
  stripped.deepResearchAt = null;

  if (Array.isArray(response.holdings)) {
    stripped.holdings = response.holdings.map(stripHolding);
  }

  stripped.viewMode = 'allocation_only';
  return stripped as T & { viewMode: 'allocation_only' };
}

function stripHolding(h: AnyHolding): AnyHolding {
  return {
    ticker: h.ticker,
    name: h.name,
    allocation: h.allocation,
    dayChangePercent: h.dayChangePercent,
    profitLossPercent: h.profitLossPercent ?? null,
    instrumentType: h.instrumentType,
    isStatic: h.isStatic,
    // Zero out any field a downstream consumer might still try to read.
    shares: 0,
    currentPrice: 0,
    previousClose: 0,
    value: 0,
    dayChange: 0,
    costBasis: null,
    profitLoss: null,
    revenue: null,
    earnings: null,
    forwardPE: null,
    pctTo52WeekHigh: null,
    week52High: null,
    operatingMargin: null,
    revenueGrowth3Y: null,
    epsGrowth3Y: null,
    regularMarketPrice: 0,
  };
}

/**
 * Convert a series of dollar values into an indexed series (first non-zero
 * point = 100). If no positive base value exists we return an empty array
 * rather than leaking the sign of the portfolio.
 */
export function indexHistory(points: HistoryPoint[] | null | undefined): HistoryPoint[] {
  if (!points || points.length === 0) return [];

  const base = points.find((p) => p.value > 0)?.value;
  if (!base) return [];

  return points.map((p) => ({
    date: p.date,
    value: Math.round((p.value / base) * 10000) / 100, // two-decimal precision
  }));
}
