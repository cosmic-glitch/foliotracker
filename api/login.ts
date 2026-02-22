import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { getPortfolio, createSession } from './_lib/db.js';

const ADMIN_HASH = '$2b$10$PHYCpLb5/4zFCetogpu3G.U3oNv6M6z7hHoL/wzaWVxSk.kq8Uucm';

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
    const { portfolioId, password } = req.body;

    if (!portfolioId || !password) {
      res.status(400).json({ error: 'Portfolio ID and password are required' });
      return;
    }

    const normalizedId = portfolioId.toLowerCase();

    // Check admin password first
    const isAdmin = await bcrypt.compare(password, ADMIN_HASH);

    if (!isAdmin) {
      // Check portfolio password
      const portfolio = await getPortfolio(normalizedId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const isValid = await bcrypt.compare(password, portfolio.password_hash);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    // Password verified — create session token
    const { token, expiresAt } = await createSession(normalizedId, isAdmin);

    res.status(200).json({
      token,
      portfolioId: normalizedId,
      isAdmin,
      expiresAt,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
