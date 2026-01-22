import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTickerNews, type NewsArticle } from './lib/yahoo.js';

const DELAY_BETWEEN_REQUESTS_MS = 200;
const MAX_TICKERS = 20;

interface NewsResponse {
  news: Record<string, NewsArticle[]>;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
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
    // Get tickers from query
    const tickersParam = req.query.tickers as string;
    if (!tickersParam) {
      res.status(400).json({ error: 'tickers parameter is required' });
      return;
    }

    const tickers = tickersParam
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0)
      .slice(0, MAX_TICKERS);

    if (tickers.length === 0) {
      res.status(400).json({ error: 'At least one valid ticker is required' });
      return;
    }

    // Fetch news for each ticker with rate limiting
    const news: Record<string, NewsArticle[]> = {};

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      news[ticker] = await getTickerNews(ticker, 5);

      // Rate limiting between requests (except for the last one)
      if (i < tickers.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
      }
    }

    const response: NewsResponse = { news };
    res.status(200).json(response);
  } catch (error) {
    console.error('News API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
