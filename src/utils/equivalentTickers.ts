import type { Holding } from '../types/portfolio';

// Equivalent ticker pairs - tickers that represent the same underlying asset
// and should be consolidated in display views
const EQUIVALENT_TICKERS: string[][] = [['GOOG', 'GOOGL']];

// Build a map from each ticker to its canonical group
const tickerToGroup = new Map<string, string[]>();
for (const group of EQUIVALENT_TICKERS) {
  for (const ticker of group) {
    tickerToGroup.set(ticker, group);
  }
}

/**
 * Consolidates holdings that represent equivalent tickers (e.g., GOOG/GOOGL)
 * into a single combined holding for display purposes.
 */
export function consolidateHoldings(holdings: Holding[]): Holding[] {
  // Track which holdings have been merged
  const processed = new Set<string>();
  const result: Holding[] = [];

  for (const holding of holdings) {
    if (processed.has(holding.ticker)) {
      continue;
    }

    const group = tickerToGroup.get(holding.ticker);
    if (!group) {
      // Not part of any equivalent group, include as-is
      result.push(holding);
      continue;
    }

    // Find all holdings in this equivalent group
    const groupHoldings = holdings.filter((h) => group.includes(h.ticker));

    if (groupHoldings.length === 1) {
      // Only one holding from this group, no merging needed
      result.push(holding);
      processed.add(holding.ticker);
      continue;
    }

    // Mark all tickers in this group as processed
    for (const h of groupHoldings) {
      processed.add(h.ticker);
    }

    // Merge the holdings
    result.push(mergeHoldings(groupHoldings, group));
  }

  // Re-sort by value descending to maintain expected order after merging
  return result.sort((a, b) => b.value - a.value);
}

/**
 * Merges multiple equivalent holdings into a single holding.
 */
function mergeHoldings(holdings: Holding[], group: string[]): Holding {
  const first = holdings[0];

  // Sum values
  const shares = holdings.reduce((sum, h) => sum + h.shares, 0);
  const value = holdings.reduce((sum, h) => sum + h.value, 0);
  const dayChange = holdings.reduce((sum, h) => sum + h.dayChange, 0);
  const allocation = holdings.reduce((sum, h) => sum + h.allocation, 0);

  // Value-weighted average for percentages
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const dayChangePercent =
    totalValue > 0
      ? holdings.reduce((sum, h) => sum + h.dayChangePercent * h.value, 0) / totalValue
      : 0;

  // Cost basis and profit/loss - sum if all non-null
  const allHaveCostBasis = holdings.every((h) => h.costBasis !== null);
  const costBasis = allHaveCostBasis
    ? holdings.reduce((sum, h) => sum + (h.costBasis ?? 0), 0)
    : null;

  const allHaveProfitLoss = holdings.every((h) => h.profitLoss !== null);
  const profitLoss = allHaveProfitLoss
    ? holdings.reduce((sum, h) => sum + (h.profitLoss ?? 0), 0)
    : null;

  // Calculate profit/loss percent from cost basis if available
  let profitLossPercent: number | null = null;
  if (costBasis !== null && costBasis > 0 && profitLoss !== null) {
    profitLossPercent = (profitLoss / costBasis) * 100;
  }

  // Use the first ticker in the group as the canonical display name
  const canonicalTicker = group[0];

  return {
    ticker: canonicalTicker,
    name: first.name,
    shares,
    currentPrice: first.currentPrice,
    previousClose: first.previousClose,
    value,
    allocation,
    dayChange,
    dayChangePercent,
    isStatic: first.isStatic,
    instrumentType: first.instrumentType,
    costBasis,
    profitLoss,
    profitLossPercent,
  };
}
