import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, authenticateRequest, getShareLinkByToken, isShareLinkValid, getHoldingsHistory } from './_lib/db.js';
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

    // Auth: history is owner-only. Valid share_token (full only) or token/password counts as authenticated.
    let authenticated = false;
    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      if (link.mode === 'allocation_only') {
        res.status(403).json({ error: 'History is available to the portfolio owner only', requiresAuth: true });
        return;
      }
      authenticated = true;
    } else if (token || password) {
      const result = await authenticateRequest(portfolioId, token, password);
      authenticated = result.authenticated;
      if ((token || password) && !authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    // Public portfolios still require owner auth for history; it's not public data. Viewers (logged_in_as) do NOT grant history access.
    if (!authenticated) {
      res.status(403).json({ error: 'History is available to the portfolio owner only', requiresAuth: true });
      return;
    }

    const history = await getHoldingsHistory(portfolioId, limit);
    res.status(200).json({ history });
  } catch (error) {
    console.error('Holdings history API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
