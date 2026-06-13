/**
 * Helpers for the `allocation_only` share-link mode.
 *
 * Strips every dollar-denominated field from a portfolio response so a
 * viewer cannot recover the owner's wealth, share counts, or absolute
 * gains/losses. `allocation` (a percentage, already computed by the
 * snapshot pipeline) is preserved so the frontend can render the existing
 * AllocationView without needing per-holding dollar values.
 */

interface AnyHolding {
  ticker: string;
  name: string;
  allocation: number;
  dayChangePercent: number;
  profitLossPercent: number | null;
  instrumentType: string;
  isStatic: boolean;
  // Anything else may be present on input — stripped on output. The strip
  // helper also writes extra zero/null fields (shares, currentPrice, …) on
  // output to defang any downstream reader; the index signature is what
  // makes those writes typecheck.
  [k: string]: unknown;
}

interface PortfolioResponseLike {
  holdings?: AnyHolding[];
  totalValue?: number;
  totalDayChange?: number;
  totalDayChangePercent?: number;
  totalGain?: number | null;
  totalGainPercent?: number | null;
  deepResearch?: string | null;
  deepResearchAt?: string | null;
  [k: string]: unknown;
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

  // The deep research report tends to mention dollar amounts, so suppress it.
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
