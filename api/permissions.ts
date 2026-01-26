import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getPortfolio,
  getPortfolioViewers,
  setPortfolioViewers,
  updatePortfolioSettings,
  verifyPortfolioPassword,
  Visibility,
} from './_lib/db.js';

interface PermissionsResponse {
  visibility: Visibility;
  viewers: string[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const portfolioId = (req.query.id as string)?.toLowerCase();

  if (!portfolioId) {
    res.status(400).json({ error: 'Portfolio ID is required' });
    return;
  }

  try {
    if (req.method === 'GET') {
      // GET requires password to view permissions
      const password = req.query.password as string;

      if (!password) {
        res.status(401).json({ error: 'Password is required' });
        return;
      }

      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const viewers = await getPortfolioViewers(portfolioId);

      const response: PermissionsResponse = {
        visibility: portfolio.visibility,
        viewers,
      };

      res.status(200).json(response);
      return;
    }

    if (req.method === 'PUT') {
      const { password, visibility, viewers } = req.body;

      if (!password) {
        res.status(401).json({ error: 'Password is required' });
        return;
      }

      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      // Validate visibility value
      if (visibility && !['public', 'private', 'selective'].includes(visibility)) {
        res.status(400).json({ error: 'Invalid visibility value' });
        return;
      }

      // Update visibility if provided
      if (visibility) {
        await updatePortfolioSettings(portfolioId, { visibility });
      }

      // Update viewers if provided (only relevant for selective visibility)
      if (viewers !== undefined) {
        // Validate that viewers is an array of strings
        if (!Array.isArray(viewers) || !viewers.every((v) => typeof v === 'string')) {
          res.status(400).json({ error: 'Viewers must be an array of portfolio IDs' });
          return;
        }

        await setPortfolioViewers(portfolioId, viewers);
      }

      // Return updated permissions
      const updatedPortfolio = await getPortfolio(portfolioId);
      const updatedViewers = await getPortfolioViewers(portfolioId);

      const response: PermissionsResponse = {
        visibility: updatedPortfolio!.visibility,
        viewers: updatedViewers,
      };

      res.status(200).json(response);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Permissions API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
