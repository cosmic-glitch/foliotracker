import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, getPortfolioSnapshot, verifyPortfolioPassword, isAllowedViewer } from './lib/db.js';
import { getSnapshotFromRedis, getPortfolioFromRedis, setPortfolioInRedis, type CachedPortfolio } from './lib/redis.js';

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
  isStale: boolean;
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
    const portfolioId = req.query.id as string;
    const interval = (req.query.interval as string) === '1m' ? '1m' : '1d';
    const password = req.query.password as string;
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Check if portfolio exists - try Redis first, then DB
    let portfolio: CachedPortfolio | null = await getPortfolioFromRedis(portfolioId);
    if (!portfolio) {
      const dbPortfolio = await getPortfolio(portfolioId);
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
          data: [],
          benchmark: [],
          lastUpdated: new Date().toISOString(),
          isStale: true,
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
          data: [],
          benchmark: [],
          lastUpdated: new Date().toISOString(),
          isStale: true,
          requiresAuth: true,
        });
        return;
      }
    }
    // Public portfolios: no auth required

    // Read from Redis first, fall back to DB
    let snapshotStart = Date.now();
    let snapshot = await getSnapshotFromRedis(portfolioId);
    console.log(`[TIMING] history.ts getSnapshotFromRedis: ${Date.now() - snapshotStart}ms`);

    if (!snapshot) {
      snapshotStart = Date.now();
      snapshot = await getPortfolioSnapshot(portfolioId);
      console.log(`[TIMING] history.ts getPortfolioSnapshot (fallback): ${Date.now() - snapshotStart}ms`);
    }

    if (!snapshot) {
      // No snapshot yet - return empty data
      const response: HistoryResponse = {
        data: [],
        benchmark: [],
        lastUpdated: new Date().toISOString(),
        isStale: true,
      };
      res.status(200).json(response);
      return;
    }

    // Return pre-computed chart data based on interval
    let data: HistoricalDataPoint[] = [];
    let benchmark: BenchmarkHistoryPoint[] = [];

    if (interval === '1m') {
      // Intraday data
      data = snapshot.history_1d_json || [];
      // No benchmark for intraday
      benchmark = [];
    } else {
      // 30D daily data
      data = snapshot.history_30d_json || [];
      benchmark = snapshot.benchmark_30d_json || [];
    }

    // Check if snapshot is stale (more than 10 minutes old)
    const snapshotAge = Date.now() - new Date(snapshot.updated_at).getTime();
    const isStale = snapshotAge > 10 * 60 * 1000;

    const response: HistoryResponse = {
      data,
      benchmark,
      lastUpdated: snapshot.updated_at,
      isStale,
    };

    console.log(`[TIMING] history.ts total: ${Date.now() - requestStart}ms (id=${portfolioId}, interval=${interval})`);
    res.status(200).json(response);
  } catch (error) {
    console.error('History API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
