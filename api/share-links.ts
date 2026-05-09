import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authenticateRequest,
  createShareLink,
  getPortfolio,
  listShareLinks,
} from './_lib/db.js';

interface MintBody {
  portfolioId?: string;
  durationDays?: number;
  label?: string;
  token?: string;
  password?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const portfolioId = (req.query.portfolioId as string)?.toLowerCase();
      const token = req.query.token as string | undefined;
      const password = req.query.password as string | undefined;

      if (!portfolioId) {
        res.status(400).json({ error: 'portfolioId is required' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const { authenticated } = await authenticateRequest(portfolioId, token, password);
      if (!authenticated) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const links = await listShareLinks(portfolioId);
      res.status(200).json({
        links: links.map((l) => ({
          id: l.id,
          token: l.token,
          label: l.label,
          createdAt: l.created_at,
          expiresAt: l.expires_at,
          revokedAt: l.revoked_at,
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as MintBody;
      const portfolioId = body.portfolioId?.toLowerCase();
      const durationDays = body.durationDays;
      const label = body.label?.trim() || null;

      if (!portfolioId) {
        res.status(400).json({ error: 'portfolioId is required' });
        return;
      }
      if (!Number.isInteger(durationDays) || (durationDays as number) < 1) {
        res.status(400).json({ error: 'durationDays must be a positive integer' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const { authenticated } = await authenticateRequest(
        portfolioId,
        body.token,
        body.password
      );
      if (!authenticated) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const link = await createShareLink(portfolioId, durationDays as number, label);

      res.status(201).json({
        id: link.id,
        token: link.token,
        label: link.label,
        createdAt: link.created_at,
        expiresAt: link.expires_at,
        revokedAt: link.revoked_at,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Share-links API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
