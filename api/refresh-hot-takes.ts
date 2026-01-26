import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { getPortfolios, getPortfolioSnapshot, updateHotTake } from './_lib/db.js';
import { generateHotTake, type HoldingSummary } from './_lib/openai.js';

const REFRESH_SECRET = process.env.REFRESH_SECRET;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify secret
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');

  if (!REFRESH_SECRET) {
    console.error('REFRESH_SECRET not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Use constant-time comparison to prevent timing attacks
  if (
    !providedSecret ||
    providedSecret.length !== REFRESH_SECRET.length ||
    !timingSafeEqual(Buffer.from(providedSecret), Buffer.from(REFRESH_SECRET))
  ) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const startTime = Date.now();
    const portfolios = await getPortfolios();

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const portfolio of portfolios) {
      try {
        const snapshot = await getPortfolioSnapshot(portfolio.id);

        if (!snapshot || snapshot.holdings_json.length === 0) {
          results.push({ id: portfolio.id, success: false, error: 'No holdings' });
          continue;
        }

        const holdings: HoldingSummary[] = snapshot.holdings_json.map((h) => ({
          ticker: h.ticker,
          name: h.name,
          value: h.value,
          allocation: h.allocation,
          instrumentType: h.instrumentType,
        }));

        const hotTake = await generateHotTake(holdings, snapshot.total_value);
        await updateHotTake(portfolio.id, hotTake);

        results.push({ id: portfolio.id, success: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to generate hot take for ${portfolio.id}:`, err);
        results.push({ id: portfolio.id, success: false, error: errorMsg });
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      message: `Regenerated ${successCount} hot takes (${failedCount} failed)`,
      duration: `${duration}ms`,
      results,
    });
  } catch (error: unknown) {
    console.error('Refresh hot takes error:', error);

    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    res.status(500).json({
      error: 'Failed to refresh hot takes',
      details: errorMessage,
    });
  }
}
