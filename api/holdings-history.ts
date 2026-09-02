import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, authenticateRequest, getShareLinkByToken, isShareLinkValid, getHoldingsHistory, isAllowedViewer, getDailyPrices, getCachedPrices, type DbHoldingsHistory } from './_lib/db.js';
import { getPortfolioFromRedis, setPortfolioInRedis, type CachedPortfolio } from './_lib/redis.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const token = req.query.token as string;
    const password = req.query.password as string;
    const shareToken = req.query.share_token as string;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Resolve portfolio (Redis → DB)
    let portfolio: CachedPortfolio | null = await getPortfolioFromRedis(portfolioId);
    if (!portfolio) {
      const dbPortfolio = await getPortfolio(portfolioId);
      if (dbPortfolio) {
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

    // Auth mirrors api/portfolio.ts: anyone who can see dollar values can see
    // the change log. That means public portfolios (no auth), owner/admin
    // token or password, invited viewers on selective portfolios, and full-mode
    // share links. Allocation-only viewers (allocation_only share link, or a
    // restricted viewer on an allocation_public portfolio) are denied — the
    // log carries share counts and static values, which are dollar data.
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();
    let authenticated = false;
    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      if (link.mode === 'allocation_only') {
        res.status(403).json({ error: 'Changes require access to portfolio values', requiresAuth: true });
        return;
      }
      authenticated = true;
    } else if (token || password) {
      const result = await authenticateRequest(portfolioId, token, password);
      authenticated = result.authenticated;
      if (!authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    let restricted = false;
    if (portfolio.visibility === 'private') {
      restricted = !authenticated;
    } else if (portfolio.visibility === 'selective') {
      const isViewer = !!loggedInAs && (await isAllowedViewer(portfolioId, loggedInAs));
      restricted = !authenticated && !isViewer;
    }
    if (restricted) {
      res.status(403).json({ error: 'Changes require access to portfolio values', requiresAuth: true });
      return;
    }

    const history = await getHoldingsHistory(portfolioId, limit);
    res.status(200).json({ history: await attachClosePrices(history) });
  } catch (error) {
    console.error('Holdings history API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const ET_DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Attach `price` to each tradeable row: the ticker's close on the ET calendar
// day the change was recorded (or the last close before it, for weekends and
// holidays). The FE turns share deltas into ~dollar amounts with it. The
// actual fill price isn't logged, so this is explicitly an approximation.
// Falls back to price_cache when daily_prices has nothing on or before that
// day (a same-day edit before the first snapshot refresh lands), and null when
// neither exists. Static rows carry their own value and get null.
async function attachClosePrices(
  history: DbHoldingsHistory[]
): Promise<Array<DbHoldingsHistory & { price: number | null }>> {
  const tradeable = history.filter((h) => !h.is_static);
  if (tradeable.length === 0) return history.map((h) => ({ ...h, price: null }));

  const tickers = [...new Set(tradeable.map((h) => h.ticker))];
  const oldestMs = Math.min(...tradeable.map((h) => new Date(h.recorded_at).getTime()));
  const days = Math.ceil((Date.now() - oldestMs) / 86_400_000) + 7;

  const closesByTicker = new Map<string, Array<{ date: string; close: number }>>();
  try {
    // getDailyPrices returns rows ordered by date asc.
    for (const row of await getDailyPrices(tickers, days)) {
      const list = closesByTicker.get(row.ticker) ?? [];
      list.push({ date: row.date, close: row.close_price });
      closesByTicker.set(row.ticker, list);
    }
  } catch (e) {
    console.warn('[holdings_history] daily price lookup failed:', e);
  }

  const missing = new Set<string>();
  const priced = history.map((h) => {
    if (h.is_static) return { ...h, price: null };
    const dateKey = ET_DATE_KEY.format(new Date(h.recorded_at));
    const closes = closesByTicker.get(h.ticker) ?? [];
    let price: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i].date <= dateKey) {
        price = closes[i].close;
        break;
      }
    }
    if (price == null) missing.add(h.ticker);
    return { ...h, price };
  });

  if (missing.size > 0) {
    try {
      const cached = await getCachedPrices([...missing]);
      for (const h of priced) {
        if (h.price == null && !h.is_static) h.price = cached.get(h.ticker)?.current_price ?? null;
      }
    } catch (e) {
      console.warn('[holdings_history] price_cache fallback failed:', e);
    }
  }
  return priced;
}
