import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, authenticateRequest, getShareLinkByToken, isShareLinkValid, getHoldingsHistory, isAllowedViewer } from './_lib/db.js';
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
    res.status(200).json({ history });
  } catch (error) {
    console.error('Holdings history API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
