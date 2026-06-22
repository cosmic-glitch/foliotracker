import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, logAnalyticsEvent, getGeoFromIP, getShareLinkByToken } from './_lib/db.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { portfolio_id, logged_in_as, share_token } = req.body;

    // Missing portfolio_id means a landing-page view — recorded with portfolio_id=null.
    if (portfolio_id) {
      const portfolio = await getPortfolio(portfolio_id);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }
    }

    // Attribute the view to a share link when the visitor arrived via
    // /:portfolioId?share=<token>. Scoped to the portfolio so a token can't
    // attribute views to the wrong portfolio. We record the link even if it's
    // expired/revoked — the access attempt is still meaningful — but never
    // attribute one portfolio's link to another's view.
    let share_link_id: string | undefined;
    if (share_token) {
      const link = await getShareLinkByToken(share_token);
      if (link && (!portfolio_id || link.portfolio_id === String(portfolio_id).toLowerCase())) {
        share_link_id = link.id;
      }
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
    const geo = await getGeoFromIP(ip);

    await logAnalyticsEvent({
      event_type: 'view',
      portfolio_id: portfolio_id || undefined,
      viewer_id: logged_in_as || undefined,
      share_link_id,
      ip_address: ip,
      country: geo?.country,
      city: geo?.city,
      region: geo?.region,
      user_agent: req.headers['user-agent'],
      referer: req.headers['referer'] as string | undefined,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Log view error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
