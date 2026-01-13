import { getHoldings, getCachedPrices } from './db.js';
import { getHistoricalData } from './fmp.js';

export interface IntradayValue {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
}

/**
 * Get the current portfolio value using intraday (1-minute) data from Yahoo Finance.
 * Returns null if no intraday data is available.
 */
export async function getIntradayPortfolioValue(
  portfolioId: string
): Promise<IntradayValue | null> {
  // Get holdings from database
  const dbHoldings = await getHoldings(portfolioId);
  const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
  const staticHoldings = dbHoldings.filter((h) => h.is_static);

  // For intraday, fetch today's data
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  // Fetch intraday data for all tradeable holdings in parallel
  const fetchPromises = tradeableHoldings.map((holding) =>
    getHistoricalData(holding.ticker, startOfDay, now, '1m').then((data) => ({
      ticker: holding.ticker,
      shares: holding.shares,
      data,
    }))
  );

  const results = await Promise.all(fetchPromises);

  // Get cached prices for holdings without intraday data (e.g., mutual funds) and for previous close
  const cachedPrices = await getCachedPrices();

  // Track holdings with and without intraday data
  let constantValue = 0;
  let previousCloseTotal = 0;
  const holdingsWithData: typeof results = [];

  for (const result of results) {
    const cached = cachedPrices.get(result.ticker);

    if (result.data.length === 0) {
      // No intraday data - use cached price for current value
      if (cached) {
        constantValue += result.shares * cached.current_price;
        previousCloseTotal += result.shares * cached.previous_close;
      }
    } else {
      holdingsWithData.push(result);
      // Still need previous close for day change calculation
      if (cached) {
        previousCloseTotal += result.shares * cached.previous_close;
      }
    }
  }

  // Add static holdings to constant value (no day change for static)
  for (const holding of staticHoldings) {
    const staticVal = holding.static_value || 0;
    constantValue += staticVal;
    previousCloseTotal += staticVal; // Static doesn't change
  }

  // If no holdings have intraday data, return null
  if (holdingsWithData.length === 0 && tradeableHoldings.length > 0) {
    return null;
  }

  // Get the most recent price for each holding with intraday data
  let intradayValue = 0;
  for (const { ticker, shares, data } of holdingsWithData) {
    if (data.length > 0) {
      // Get the last (most recent) price
      const lastPrice = data[data.length - 1].close;
      intradayValue += shares * lastPrice;
    }
  }

  const totalValue = constantValue + intradayValue;
  const dayChange = totalValue - previousCloseTotal;
  const dayChangePercent = previousCloseTotal > 0
    ? (dayChange / previousCloseTotal) * 100
    : 0;

  return {
    totalValue,
    dayChange,
    dayChangePercent,
  };
}
