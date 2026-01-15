import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolioSnapshot } from './lib/db.js';
import { getSnapshotFromRedis } from './lib/redis.js';

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

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

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

    // Cache for 30 seconds since data is pre-computed
    res.setHeader('Cache-Control', 'public, max-age=30');
    console.log(`[TIMING] history.ts total: ${Date.now() - requestStart}ms (id=${portfolioId}, interval=${interval})`);
    res.status(200).json(response);
  } catch (error) {
    console.error('History API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
