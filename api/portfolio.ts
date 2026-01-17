import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, verifyPortfolioPassword, isAllowedViewer, getPortfolioViewers, getPortfolioSnapshot, getCachedPrices, type Visibility } from './lib/db.js';
import { getMarketStatus } from './lib/cache.js';
import { getSnapshotFromRedis, getPortfolioFromRedis, setPortfolioInRedis, getPricesFromRedis, type CachedPortfolio } from './lib/redis.js';

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
  costBasis: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
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
  totalGain: number | null;
  totalGainPercent: number | null;
  holdings: Holding[];
  lastUpdated: string;
  isStale: boolean;
  marketStatus: string;
  benchmark: BenchmarkData | null;
  isPrivate: boolean;
  visibility: Visibility;
  viewers?: string[];
  lastError?: string | null;
  lastErrorAt?: string | null;
}

// Helper to time async operations
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`[TIMING] ${name}: ${Date.now() - start}ms`);
  return result;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const requestStart = Date.now();

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

    // Check if portfolio exists - try Redis first, then DB
    let portfolio: CachedPortfolio | null = await timed('getPortfolioFromRedis', () => getPortfolioFromRedis(portfolioId));
    if (!portfolio) {
      const dbPortfolio = await timed('getPortfolio (fallback)', () => getPortfolio(portfolioId));
      if (dbPortfolio) {
        // Cache it for next time
        await setPortfolioInRedis(dbPortfolio);
        portfolio = {
          id: dbPortfolio.id,
          display_name: dbPortfolio.display_name,
          created_at: dbPortfolio.created_at,
          is_private: dbPortfolio.is_private,
          visibility: dbPortfolio.visibility,
        };
      }
    }
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Handle visibility-based authentication
    const password = req.query.password as string;
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();

    // If password is provided, verify it regardless of visibility (for login flow)
    if (password) {
      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    if (portfolio.visibility === 'private') {
      // Private portfolios require password
      if (!password) {
        res.status(200).json({
          portfolioId,
          displayName: portfolio.display_name,
          isPrivate: true,
          visibility: portfolio.visibility,
          requiresAuth: true,
        });
        return;
      }

      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    } else if (portfolio.visibility === 'selective') {
      // Selective portfolios require either password or being an allowed viewer
      const hasPassword = password && await verifyPortfolioPassword(portfolioId, password);
      const isViewer = loggedInAs && await isAllowedViewer(portfolioId, loggedInAs);

      if (!hasPassword && !isViewer) {
        res.status(200).json({
          portfolioId,
          displayName: portfolio.display_name,
          isPrivate: false,
          visibility: portfolio.visibility,
          requiresAuth: true,
        });
        return;
      }
    }
    // Public portfolios: no auth required

    // Read from Redis first, fall back to DB
    let snapshot = await timed('getSnapshotFromRedis', () => getSnapshotFromRedis(portfolioId));
    if (!snapshot) {
      snapshot = await timed('getPortfolioSnapshot (fallback)', () => getPortfolioSnapshot(portfolioId));
    }

    if (!snapshot) {
      // No snapshot available yet - return empty state
      res.status(200).json({
        portfolioId,
        displayName: portfolio.display_name,
        totalValue: 0,
        totalDayChange: 0,
        totalDayChangePercent: 0,
        totalGain: null,
        totalGainPercent: null,
        holdings: [],
        lastUpdated: new Date().toISOString(),
        marketStatus: 'unknown',
        benchmark: null,
        isPrivate: portfolio.visibility === 'private',
        visibility: portfolio.visibility,
        message: 'Snapshot not yet available. Please wait for the next refresh cycle.',
      });
      return;
    }

    // Get benchmark data from price cache - try Redis first
    let benchmark: BenchmarkData | null = null;
    let cachedPrices = await timed('getPricesFromRedis', () => getPricesFromRedis([BENCHMARK_TICKER]));
    if (cachedPrices.size === 0) {
      cachedPrices = await timed('getCachedPrices (fallback)', () => getCachedPrices([BENCHMARK_TICKER]));
    }
    const spyPrice = cachedPrices.get(BENCHMARK_TICKER);
    if (spyPrice) {
      benchmark = {
        ticker: BENCHMARK_TICKER,
        name: BENCHMARK_NAME,
        dayChangePercent: spyPrice.change_percent,
      };
    }

    // Fetch viewers if selective visibility
    const viewers = portfolio.visibility === 'selective'
      ? await timed('getPortfolioViewers', () => getPortfolioViewers(portfolioId))
      : undefined;

    // Check if snapshot is stale (more than 10 minutes old during market hours)
    const snapshotAge = Date.now() - new Date(snapshot.updated_at).getTime();
    const isStale = snapshotAge > 10 * 60 * 1000; // Stale if > 10 minutes old

    const response: PortfolioResponse = {
      portfolioId,
      displayName: portfolio.display_name,
      totalValue: snapshot.total_value,
      totalDayChange: snapshot.day_change,
      totalDayChangePercent: snapshot.day_change_percent,
      totalGain: snapshot.total_gain,
      totalGainPercent: snapshot.total_gain_percent,
      holdings: snapshot.holdings_json,
      lastUpdated: snapshot.updated_at,
      isStale,
      marketStatus: getMarketStatus(),
      benchmark,
      isPrivate: portfolio.visibility === 'private',
      visibility: portfolio.visibility,
      viewers,
      lastError: snapshot.last_error,
      lastErrorAt: snapshot.last_error_at,
    };

    console.log(`[TIMING] portfolio.ts total: ${Date.now() - requestStart}ms (id=${portfolioId})`);
    res.status(200).json(response);
  } catch (error) {
    console.error('Portfolio API error:', error);
    console.log(`[TIMING] portfolio.ts error after: ${Date.now() - requestStart}ms`);
    res.status(500).json({ error: 'Internal server error' });
  }
}
