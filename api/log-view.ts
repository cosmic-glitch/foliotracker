import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, logAnalyticsEvent, getGeoFromIP } from './_lib/db.js';

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
    const { portfolio_id, password, logged_in_as } = req.body;

    if (!portfolio_id) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Verify portfolio exists
    const portfolio = await getPortfolio(portfolio_id);
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Log analytics event
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
    const geo = await getGeoFromIP(ip);

    await logAnalyticsEvent({
      event_type: password ? 'login' : 'view',
      portfolio_id,
      viewer_id: logged_in_as || undefined,
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
