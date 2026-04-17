import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTickerNews, type NewsArticle } from './_lib/yahoo.js';
import { getLatestTickerNewsSummaries, type TickerNewsSource } from './_lib/db.js';

const DELAY_BETWEEN_REQUESTS_MS = 200;
const MAX_TICKERS = 20;

interface AiSummary {
  kind: 'ai';
  summaryMarkdown: string;
  sources: TickerNewsSource[];
  summaryDate: string;
}

interface FallbackNews {
  kind: 'fallback';
  articles: NewsArticle[];
}

type TickerNews = AiSummary | FallbackNews;

interface NewsResponse {
  news: Record<string, TickerNews>;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
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

    const summaries = await getLatestTickerNewsSummaries(tickers);

    const news: Record<string, TickerNews> = {};
    const missingTickers: string[] = [];

    for (const ticker of tickers) {
      const s = summaries.get(ticker);
      if (s) {
        news[ticker] = {
          kind: 'ai',
          summaryMarkdown: s.summary_markdown,
          sources: s.sources_json,
          summaryDate: s.summary_date,
        };
      } else {
        missingTickers.push(ticker);
      }
    }

    // Fallback: fetch Yahoo headlines for tickers without an AI summary yet.
    for (let i = 0; i < missingTickers.length; i++) {
      const ticker = missingTickers[i];
      const articles = await getTickerNews(ticker, 5);
      news[ticker] = { kind: 'fallback', articles };

      if (i < missingTickers.length - 1) {
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
