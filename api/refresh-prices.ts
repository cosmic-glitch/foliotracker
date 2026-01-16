import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { refreshAllSnapshots } from './lib/snapshot.js';

const REFRESH_SECRET = process.env.REFRESH_SECRET;

// Simple in-memory rate limiting (1 request per 45 seconds)
let lastRefreshTime = 0;
const RATE_LIMIT_MS = 45 * 1000; // 45 seconds

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

  // Rate limiting check
  const now = Date.now();
  if (now - lastRefreshTime < RATE_LIMIT_MS) {
    const waitTime = Math.ceil((RATE_LIMIT_MS - (now - lastRefreshTime)) / 1000);
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Please wait ${waitTime} seconds before refreshing again`,
    });
    return;
  }
  lastRefreshTime = now;

  try {
    const startTime = Date.now();
    await refreshAllSnapshots();
    const duration = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: 'All portfolio snapshots refreshed',
      duration: `${duration}ms`,
    });
  } catch (error: unknown) {
    console.error('Refresh error:', error);

    // Extract error message from various error types (Error, PostgrestError, etc.)
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    res.status(500).json({
      error: 'Failed to refresh snapshots',
      details: errorMessage,
    });
  }
}
