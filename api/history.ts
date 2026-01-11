import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getHoldings,
  getDailyPrices,
  upsertDailyPrice,
  getCachedPrices,
} from './lib/db.js';
import { getHistoricalData } from './lib/fmp.js';

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

// Handle intraday (1-minute interval) data - no caching
async function handleIntraday(
  req: VercelRequest,
  res: VercelResponse,
  portfolioId: string
): Promise<void> {
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

  // Get cached prices for holdings without intraday data (e.g., mutual funds)
  const cachedPrices = await getCachedPrices();

  // Identify holdings without intraday data and calculate their constant value
  let constantValue = 0;
  const holdingsWithData: typeof results = [];

  for (const result of results) {
    if (result.data.length === 0) {
      // No intraday data - use cached price
      const cached = cachedPrices.get(result.ticker);
      if (cached) {
        constantValue += result.shares * cached.current_price;
      }
    } else {
      holdingsWithData.push(result);
    }
  }

  // Add static holdings to constant value
  for (const holding of staticHoldings) {
    constantValue += holding.static_value || 0;
  }

  // Build a map of timestamp -> total portfolio value
  const timestampValues = new Map<string, number>();

  // Collect all unique timestamps from holdings with data
  const allTimestamps = new Set<string>();
  for (const { data } of holdingsWithData) {
    for (const point of data) {
      allTimestamps.add(point.date);
    }
  }

  // Sort timestamps
  const sortedTimestamps = Array.from(allTimestamps).sort();

  // Build price maps for each ticker
  const priceMaps = new Map<string, Map<string, number>>();
  for (const { ticker, data } of holdingsWithData) {
    const priceMap = new Map<string, number>();
    for (const point of data) {
      priceMap.set(point.date, point.close);
    }
    priceMaps.set(ticker, priceMap);
  }

  // Calculate portfolio value at each timestamp
  for (const timestamp of sortedTimestamps) {
    let totalValue = constantValue; // Start with holdings without intraday data + static

    // Add tradeable holdings that have intraday data
    for (const { ticker, shares } of holdingsWithData) {
      const priceMap = priceMaps.get(ticker);
      if (priceMap) {
        // Use the price for this timestamp, or find the most recent price
        let price = priceMap.get(timestamp);
        if (!price) {
          // Find most recent previous price
          for (const ts of sortedTimestamps) {
            if (ts > timestamp) break;
            const p = priceMap.get(ts);
            if (p) price = p;
          }
        }
        if (price) {
          totalValue += shares * price;
        }
      }
    }

    if (totalValue > 0) {
      timestampValues.set(timestamp, totalValue);
    }
  }

  // Convert to response format
  const data: HistoricalDataPoint[] = Array.from(timestampValues.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const response: HistoryResponse = {
    data,
    benchmark: [], // No benchmark for intraday
    lastUpdated: new Date().toISOString(),
  };

  // No caching for intraday data - always fetch fresh
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(response);
}

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
    const interval = (req.query.interval as string) === '1m' ? '1m' : '1d';

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // For intraday data, use a separate code path (no caching)
    if (interval === '1m') {
      return handleIntraday(req, res, portfolioId);
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

    // Fetch missing historical data from FMP
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

    // No caching - history depends on current holdings which can change anytime
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(response);
  } catch (error) {
    console.error('History API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
