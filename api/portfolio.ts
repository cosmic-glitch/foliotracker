import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, verifyPortfolioPassword, isAllowedViewer, getPortfolioViewers, getPortfolioSnapshot, getCachedPrices, logAnalyticsEvent, getGeoFromIP, getPortfolioHotTake, getChatHistory, addChatMessage, clearChatHistory, getTodayChatCount, type Visibility } from './_lib/db.js';
import { chatWithPortfolio, type HoldingSummary } from './_lib/openai.js';
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
  hotTake: string | null;
  hotTakeAt: string | null;
}

// Helper to time async operations
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`[TIMING] ${name}: ${Date.now() - start}ms`);
  return result;
}

const MAX_MESSAGES_PER_DAY = 10;

// Chat action handler
async function handleChatAction(req: VercelRequest, res: VercelResponse): Promise<void> {
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

  if (req.method === 'GET') {
    // Return hot take and chat history
    const [hotTakeData, chatHistory] = await Promise.all([
      getPortfolioHotTake(portfolioId),
      getChatHistory(portfolioId),
    ]);

    const messages = chatHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        created_at: m.created_at,
      }));

    res.status(200).json({
      hotTake: hotTakeData.hot_take,
      hotTakeAt: hotTakeData.hot_take_at,
      messages,
    });
    return;
  }

  if (req.method === 'POST') {
    const { message, password } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Verify access for private portfolios
    if (portfolio.visibility === 'private') {
      if (!password) {
        res.status(401).json({ error: 'Password required for private portfolio' });
        return;
      }
      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    // Check daily rate limit
    const todayCount = await getTodayChatCount(portfolioId);
    if (todayCount >= MAX_MESSAGES_PER_DAY) {
      res.status(429).json({
        error: 'Daily chat limit reached',
        message: `This portfolio has reached its limit of ${MAX_MESSAGES_PER_DAY} messages today. Try again tomorrow!`,
      });
      return;
    }

    // Get portfolio snapshot for holdings context
    const snapshot = await getPortfolioSnapshot(portfolioId);
    if (!snapshot || snapshot.holdings_json.length === 0) {
      res.status(400).json({ error: 'Portfolio has no holdings to discuss' });
      return;
    }

    // Get hot take
    const hotTakeData = await getPortfolioHotTake(portfolioId);
    if (!hotTakeData.hot_take) {
      res.status(400).json({ error: 'Portfolio has no hot take yet. Try editing the portfolio.' });
      return;
    }

    // Get chat history
    const chatHistory = await getChatHistory(portfolioId);
    const history = chatHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Build holdings summary
    const holdings: HoldingSummary[] = snapshot.holdings_json.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      value: h.value,
      allocation: h.allocation,
      instrumentType: h.instrumentType,
    }));

    // Call OpenAI
    const userMessage = message.trim();
    let aiResponse: string;
    try {
      aiResponse = await chatWithPortfolio(
        holdings,
        snapshot.total_value,
        hotTakeData.hot_take,
        history,
        userMessage
      );
    } catch (err) {
      console.error('OpenAI chat error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get AI response', details: errorMessage });
      return;
    }

    // Log messages to database
    await addChatMessage(portfolioId, 'user', userMessage);
    await addChatMessage(portfolioId, 'assistant', aiResponse);

    res.status(200).json({
      response: aiResponse,
      remainingMessages: MAX_MESSAGES_PER_DAY - todayCount - 1,
    });
    return;
  }

  if (req.method === 'DELETE') {
    const { password } = req.body;

    if (!password) {
      res.status(401).json({ error: 'Password required to reset chat' });
      return;
    }

    const isValid = await verifyPortfolioPassword(portfolioId, password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    await clearChatHistory(portfolioId);
    res.status(200).json({ message: 'Chat history cleared' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
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

  // Handle chat actions
  const action = req.query.action as string;
  if (action === 'chat') {
    await handleChatAction(req, res);
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

    // Fetch hot take
    const hotTakeData = await timed('getPortfolioHotTake', () => getPortfolioHotTake(portfolioId));

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
      hotTake: hotTakeData.hot_take,
      hotTakeAt: hotTakeData.hot_take_at,
    };

    // Non-blocking analytics logging
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
    getGeoFromIP(ip).then((geo) => {
      logAnalyticsEvent({
        event_type: password ? 'login' : 'view',
        portfolio_id: portfolioId,
        viewer_id: loggedInAs || undefined,
        ip_address: ip,
        country: geo?.country,
        city: geo?.city,
        region: geo?.region,
        user_agent: req.headers['user-agent'],
        referer: req.headers['referer'],
      }).catch(() => {}); // Fire and forget
    }).catch(() => {});

    console.log(`[TIMING] portfolio.ts total: ${Date.now() - requestStart}ms (id=${portfolioId})`);
    res.status(200).json(response);
  } catch (error) {
    console.error('Portfolio API error:', error);
    console.log(`[TIMING] portfolio.ts error after: ${Date.now() - requestStart}ms`);
    res.status(500).json({ error: 'Internal server error' });
  }
}
