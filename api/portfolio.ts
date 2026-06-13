import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, authenticateRequest, isAllowedViewer, getPortfolioViewers, getPortfolioSnapshot, getCachedPrices, getPortfolioDeepResearch, getShareLinkByToken, isShareLinkValid, type Visibility, type ShareLinkMode } from './_lib/db.js';
import { stripPortfolioForAllocationOnly } from './_lib/anonymize.js';
import { getMarketStatus } from './_lib/cache.js';
import { getSnapshotFromRedis, getPortfolioFromRedis, setPortfolioInRedis, getPricesFromRedis, type CachedPortfolio } from './_lib/redis.js';

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
  // Tolerates extra fields the snapshot carries (revenue, earnings,
  // forwardPE, 52w high, thirtyDayChange{,Percent}, etc.) without listing
  // every one here, and satisfies AnyHolding's constraint in anonymize.ts.
  [k: string]: unknown;
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
  staleTickers: string[];
  lastError?: string | null;
  lastErrorAt?: string | null;
  deepResearch: string | null;
  deepResearchAt: string | null;
  viewMode?: 'full' | 'allocation_only';
  // Set when viewMode === 'allocation_only' so the FE can pick the right banner copy.
  // 'share_link' = viewer arrived via a ?share=... token in allocation_only mode.
  // 'restricted' = viewer lacks owner-level permission on a portfolio that allows public allocation.
  viewSource?: 'share_link' | 'restricted';
  // Satisfies PortfolioResponseLike's index signature (anonymize.ts) so this
  // object can be passed to the generic stripPortfolioForAllocationOnly.
  [k: string]: unknown;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
          allocation_public: dbPortfolio.allocation_public,
        };
      }
    }
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Handle visibility-based authentication
    const token = req.query.token as string;
    const password = req.query.password as string;
    const shareToken = req.query.share_token as string;
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();

    let authResult = { authenticated: false, isAdmin: false };
    let shareLinkMode: ShareLinkMode | null = null;

    // Share token: if present, validate and short-circuit visibility checks.
    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      authResult = { authenticated: true, isAdmin: false };
      shareLinkMode = link.mode;
    } else if (token || password) {
      authResult = await authenticateRequest(portfolioId, token, password);
      if ((token || password) && !authResult.authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    // Compute whether the viewer lacks owner-level access. Share-token viewers
    // are already marked `authenticated: true` above, so they bypass this.
    let restricted = false;
    if (portfolio.visibility === 'private') {
      restricted = !authResult.authenticated;
    } else if (portfolio.visibility === 'selective') {
      const isViewer = !!loggedInAs && (await isAllowedViewer(portfolioId, loggedInAs));
      restricted = !authResult.authenticated && !isViewer;
    }
    // `?? true` tolerates Redis blobs cached before migration 010 added the field.
    const allocationPublic = portfolio.allocation_public ?? true;

    if (restricted && !allocationPublic) {
      // Owner has opted out of public allocation — return today's opaque stub.
      res.status(200).json({
        portfolioId,
        displayName: portfolio.display_name,
        isPrivate: portfolio.visibility === 'private',
        visibility: portfolio.visibility,
        requiresAuth: true,
      });
      return;
    }
    // If `restricted && allocationPublic`, fall through. The strip step at the
    // bottom of the handler anonymizes the response into allocation-only form.
    // Public portfolios: no auth required.

    // Read from Redis first, fall back to DB
    let snapshot = await timed('getSnapshotFromRedis', () => getSnapshotFromRedis(portfolioId));
    if (!snapshot) {
      snapshot = await timed('getPortfolioSnapshot (fallback)', () => getPortfolioSnapshot(portfolioId));
    }

    if (!snapshot) {
      // No snapshot available yet - return empty state.
      // If the viewer is restricted-but-allocation-public, tag the placeholder
      // with viewMode so the FE shows the allocation-only banner instead of a
      // blank "snapshot pending" page.
      const emptyResponse: Record<string, unknown> = {
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
      };
      if (restricted && allocationPublic) {
        emptyResponse.viewMode = 'allocation_only';
        emptyResponse.viewSource = 'restricted';
      }
      res.status(200).json(emptyResponse);
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

    // Fetch deep research report
    const deepResearch = await timed('getPortfolioDeepResearch', () => getPortfolioDeepResearch(portfolioId));

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
      staleTickers: snapshot.stale_tickers ?? [],
      lastError: snapshot.last_error,
      lastErrorAt: snapshot.last_error_at,
      deepResearch: deepResearch.deep_research,
      deepResearchAt: deepResearch.deep_research_at,
    };

    // Anonymize when either (a) the viewer arrived via an allocation-only share
    // link, or (b) the viewer is restricted on a portfolio with allocation_public
    // turned on. `viewSource` lets the FE pick the right banner copy.
    const allocationOnly =
      shareLinkMode === 'allocation_only' || (restricted && allocationPublic);
    // Earlier this had an explicit `typeof response | (typeof response & { viewSource })`
    // annotation, but the spread of the generic stripPortfolioForAllocationOnly
    // result widened the literal back to PortfolioResponseLike's structural
    // shape (most fields optional), so TS reported PortfolioResponse fields
    // as missing. Letting inference run produces the right union shape.
    const viewSource: 'share_link' | 'restricted' =
      shareLinkMode === 'allocation_only' ? 'share_link' : 'restricted';
    const finalResponse = allocationOnly
      ? { ...stripPortfolioForAllocationOnly(response), viewSource }
      : response;

    console.log(`[TIMING] portfolio.ts total: ${Date.now() - requestStart}ms (id=${portfolioId})`);
    res.status(200).json(finalResponse);
  } catch (error) {
    console.error('Portfolio API error:', error);
    console.log(`[TIMING] portfolio.ts error after: ${Date.now() - requestStart}ms`);
    res.status(500).json({ error: 'Internal server error' });
  }
}
