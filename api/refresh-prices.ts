import type { VercelRequest, VercelResponse } from '@vercel/node';
import { refreshAllSnapshots } from './lib/snapshot.js';

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

  if (providedSecret !== REFRESH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const startTime = Date.now();
    await refreshAllSnapshots();
    const duration = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: 'All portfolio snapshots refreshed',
      duration: `${duration}ms`,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({
      error: 'Failed to refresh snapshots',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
