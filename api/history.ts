import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getHoldings,
  getDailyPrices,
  upsertDailyPrice,
} from './lib/db.js';
import { getHistoricalData } from './lib/finnhub.js';

interface HistoricalDataPoint {
  date: string;
  value: number;
}

interface BenchmarkHistoryPoint {
  date: string;
  percentChange: number;
}

interface HistoryResponse {
  data: HistoricalDataPoint[];
  benchmark: BenchmarkHistoryPoint[];
  lastUpdated: string;
}

const BENCHMARK_TICKER = 'SPY';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const days = parseInt(req.query.days as string) || 30;
    const portfolioId = req.query.id as string;

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Get holdings from database
    const dbHoldings = await getHoldings(portfolioId);
    const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
    const staticHoldings = dbHoldings.filter((h) => h.is_static);

    const tickers = tradeableHoldings.map((h) => h.ticker);

    // Get existing daily prices from database (include SPY for benchmark)
    const allTickers = [...tickers, BENCHMARK_TICKER];
    const existingPrices = await getDailyPrices(allTickers, days);

    // Check which dates we're missing for each ticker
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const existingDates = new Map<string, Set<string>>();
    for (const price of existingPrices) {
      if (!existingDates.has(price.ticker)) {
        existingDates.set(price.ticker, new Set());
      }
      existingDates.get(price.ticker)!.add(price.date);
    }

    // Fetch missing historical data from Finnhub
    const allPrices = new Map<string, Map<string, number>>();

    // Initialize with existing data
    for (const price of existingPrices) {
      if (!allPrices.has(price.ticker)) {
        allPrices.set(price.ticker, new Map());
      }
      allPrices.get(price.ticker)!.set(price.date, price.close_price);
    }

    // Find tickers that need data fetched
    // Only refetch if we have no data OR most recent cached date is >3 days old
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoffDate = threeDaysAgo.toISOString().split('T')[0];

    const tickersToFetch: string[] = [];
    for (const holding of tradeableHoldings) {
      const tickerDates = existingDates.get(holding.ticker) || new Set();
      const sortedDates = Array.from(tickerDates).sort();
      const mostRecentCached = sortedDates[sortedDates.length - 1];

      if (tickerDates.size === 0 || (mostRecentCached && mostRecentCached < cutoffDate)) {
        tickersToFetch.push(holding.ticker);
      }
    }

    // Also check if we need SPY benchmark data
    const spyDates = existingDates.get(BENCHMARK_TICKER) || new Set();
    const spySortedDates = Array.from(spyDates).sort();
    const spyMostRecent = spySortedDates[spySortedDates.length - 1];
    const needSpyData = spyDates.size === 0 || (spyMostRecent && spyMostRecent < cutoffDate);
    if (needSpyData) {
      tickersToFetch.push(BENCHMARK_TICKER);
    }

    // Fetch all missing data in parallel
    if (tickersToFetch.length > 0) {
      const fetchPromises = tickersToFetch.map((ticker) =>
        getHistoricalData(ticker, startDate, today).then((data) => ({ ticker, data }))
      );
      const results = await Promise.all(fetchPromises);

      // Collect ALL cache writes across all tickers first
      const allCachePromises: Promise<void>[] = [];

      // Process results
      for (const { ticker, data: historicalData } of results) {
        if (!allPrices.has(ticker)) {
          allPrices.set(ticker, new Map());
        }

        const tickerDates = existingDates.get(ticker) || new Set();

        for (const point of historicalData) {
          allPrices.get(ticker)!.set(point.date, point.close);

          // Queue cache write (don't await yet)
          if (!tickerDates.has(point.date)) {
            allCachePromises.push(upsertDailyPrice(ticker, point.date, point.close));
          }
        }
      }

      // Execute ALL cache writes in one parallel batch (non-blocking for response)
      if (allCachePromises.length > 0) {
        // Fire and forget - don't block the response on cache writes
        Promise.all(allCachePromises).catch((err) =>
          console.error('Cache write error:', err)
        );
      }
    }

    // Calculate portfolio value for each date
    const dateValues = new Map<string, number>();

    // Get all unique dates
    const allDates = new Set<string>();
    for (const tickerPrices of allPrices.values()) {
      for (const date of tickerPrices.keys()) {
        allDates.add(date);
      }
    }

    // Sort dates
    const sortedDates = Array.from(allDates).sort();

    // For each date, calculate total portfolio value
    for (const date of sortedDates) {
      let totalValue = 0;

      // Add tradeable holdings
      for (const holding of tradeableHoldings) {
        const tickerPrices = allPrices.get(holding.ticker);
        if (tickerPrices) {
          // Use the price for this date, or the most recent previous price
          let price = tickerPrices.get(date);
          if (!price) {
            // Find most recent previous price
            for (const d of sortedDates) {
              if (d > date) break;
              const p = tickerPrices.get(d);
              if (p) price = p;
            }
          }
          if (price) {
            totalValue += holding.shares * price;
          }
        }
      }

      // Add static holdings (constant value)
      for (const holding of staticHoldings) {
        totalValue += holding.static_value || 0;
      }

      if (totalValue > 0) {
        dateValues.set(date, totalValue);
      }
    }

    // Convert to response format
    const data: HistoricalDataPoint[] = Array.from(dateValues.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-days);

    // Calculate SPY benchmark data from cached prices
    let benchmark: BenchmarkHistoryPoint[] = [];
    const spyPrices = allPrices.get(BENCHMARK_TICKER);
    if (spyPrices && spyPrices.size > 0) {
      const spyDataSorted = Array.from(spyPrices.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-days);

      if (spyDataSorted.length > 0) {
        const startPrice = spyDataSorted[0][1];
        benchmark = spyDataSorted.map(([date, close]) => ({
          date,
          percentChange: ((close - startPrice) / startPrice) * 100,
        }));
      }
    }

    const response: HistoryResponse = {
      data,
      benchmark,
      lastUpdated: new Date().toISOString(),
    };

    // Cache aggressively - historical data is very stable
    // Browser: 24 hours, CDN: 1 hour, stale-while-revalidate: 24 hours
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(response);
  } catch (error) {
    console.error('History API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
