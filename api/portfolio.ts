import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getHoldings, getPortfolio, getCachedPrices, updatePriceCache, verifyPortfolioPassword } from './lib/db.js';
import { getMultipleQuotes, getQuote, isMutualFund, getMutualFundQuote } from './lib/finnhub.js';
import { isCacheStale, getMarketStatus } from './lib/cache.js';

const BENCHMARK_TICKER = 'SPY';
const BENCHMARK_NAME = 'S&P 500';

interface Holding {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  previousClose: number;
  value: number;
  allocation: number;
  dayChange: number;
  dayChangePercent: number;
  isStatic: boolean;
  instrumentType: string;
}

interface BenchmarkData {
  ticker: string;
  name: string;
  dayChangePercent: number;
}

interface PortfolioResponse {
  portfolioId: string;
  displayName: string | null;
  totalValue: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  holdings: Holding[];
  lastUpdated: string;
  marketStatus: string;
  benchmark: BenchmarkData | null;
  isPrivate: boolean;
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
    // Get portfolio ID from query
    const portfolioId = req.query.id as string;
    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Check if portfolio exists
    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Handle private portfolio authentication
    if (portfolio.is_private) {
      const password = req.query.password as string;

      if (!password) {
        // Return minimal info to indicate portfolio exists but is private
        res.status(200).json({
          portfolioId,
          displayName: portfolio.display_name,
          isPrivate: true,
          requiresAuth: true,
        });
        return;
      }

      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    // Get holdings from database
    const dbHoldings = await getHoldings(portfolioId);
    const cachedPrices = await getCachedPrices();

    // Separate tradeable and static holdings
    const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
    const staticHoldings = dbHoldings.filter((h) => h.is_static);

    // Separate mutual funds from regular stocks/ETFs
    const mutualFundHoldings = tradeableHoldings.filter((h) => isMutualFund(h.ticker));
    const stockEtfHoldings = tradeableHoldings.filter((h) => !isMutualFund(h.ticker));

    // Check which stock/ETF prices need refreshing
    const tickersToRefresh: string[] = [];
    for (const holding of stockEtfHoldings) {
      const cached = cachedPrices.get(holding.ticker);
      if (!cached || isCacheStale(cached)) {
        tickersToRefresh.push(holding.ticker);
      }
    }

    // Fetch fresh stock/ETF prices from Finnhub if needed
    if (tickersToRefresh.length > 0) {
      const quotes = await getMultipleQuotes(tickersToRefresh);

      // Update cache
      for (const [ticker, quote] of quotes) {
        await updatePriceCache(ticker, quote.c, quote.pc);
        cachedPrices.set(ticker, {
          ticker,
          current_price: quote.c,
          previous_close: quote.pc,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Fetch mutual fund prices from CNBC
    for (const holding of mutualFundHoldings) {
      const cached = cachedPrices.get(holding.ticker);
      if (!cached || isCacheStale(cached)) {
        const quote = await getMutualFundQuote(holding.ticker);
        if (quote) {
          await updatePriceCache(holding.ticker, quote.price, quote.previousClose);
          cachedPrices.set(holding.ticker, {
            ticker: holding.ticker,
            current_price: quote.price,
            previous_close: quote.previousClose,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Build holdings response
    const holdings: Holding[] = [];

    // Process tradeable holdings
    for (const holding of tradeableHoldings) {
      const cached = cachedPrices.get(holding.ticker);
      if (!cached) {
        console.warn(`No price data for ${holding.ticker}`);
        continue;
      }

      const value = holding.shares * cached.current_price;
      const previousValue = holding.shares * cached.previous_close;
      const dayChange = value - previousValue;
      const dayChangePercent =
        previousValue > 0 ? (dayChange / previousValue) * 100 : 0;

      holdings.push({
        ticker: holding.ticker,
        name: holding.name,
        shares: holding.shares,
        currentPrice: cached.current_price,
        previousClose: cached.previous_close,
        value,
        allocation: 0, // Calculated later
        dayChange,
        dayChangePercent,
        isStatic: false,
        instrumentType: holding.instrument_type || 'Other',
      });
    }

    // Process static holdings
    for (const holding of staticHoldings) {
      const value = holding.static_value || 0;
      holdings.push({
        ticker: holding.ticker,
        name: holding.name,
        shares: holding.shares,
        currentPrice: value,
        previousClose: value,
        value,
        allocation: 0,
        dayChange: 0,
        dayChangePercent: 0,
        isStatic: true,
        instrumentType: holding.instrument_type || 'Other',
      });
    }

    // Calculate totals and allocations
    const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
    const totalDayChange = holdings.reduce((sum, h) => sum + h.dayChange, 0);
    const previousTotalValue = totalValue - totalDayChange;
    const totalDayChangePercent =
      previousTotalValue > 0 ? (totalDayChange / previousTotalValue) * 100 : 0;

    // Set allocations
    for (const holding of holdings) {
      holding.allocation = totalValue > 0 ? (holding.value / totalValue) * 100 : 0;
    }

    // Sort by value descending
    holdings.sort((a, b) => b.value - a.value);

    // Fetch S&P 500 benchmark data
    let benchmark: BenchmarkData | null = null;
    try {
      const spyQuote = await getQuote(BENCHMARK_TICKER);
      if (spyQuote && spyQuote.pc > 0) {
        benchmark = {
          ticker: BENCHMARK_TICKER,
          name: BENCHMARK_NAME,
          dayChangePercent: spyQuote.dp,
        };
      }
    } catch (error) {
      console.warn('Could not fetch benchmark data:', error);
    }

    const response: PortfolioResponse = {
      portfolioId,
      displayName: portfolio.display_name,
      totalValue,
      totalDayChange,
      totalDayChangePercent,
      holdings,
      lastUpdated: new Date().toISOString(),
      marketStatus: getMarketStatus(),
      benchmark,
      isPrivate: portfolio.is_private,
    };

    // Cache response for 1 minute
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(response);
  } catch (error) {
    console.error('Portfolio API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
