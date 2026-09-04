import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLatestTickerNewsSummaries, type TickerNewsSource } from './_lib/db.js';

const MAX_TICKERS = 20;

// Only AI summaries (generate-news.sh → ticker_news_summaries) are served.
// Tickers with no summary in the last 7 days are simply absent from the
// response. There used to be a raw Yahoo-headline fallback for them; it was
// removed because the headlines were low-quality noise — the UI shows a
// "pending" state instead. `kind` is kept so the client type stays a
// discriminated union should another source ever be added.
interface AiSummary {
  kind: 'ai';
  summaryMarkdown: string;
  sources: TickerNewsSource[];
  summaryDate: string;
}

type TickerNews = AiSummary;

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
    for (const ticker of tickers) {
      const s = summaries.get(ticker);
      if (!s) continue;
      news[ticker] = {
        kind: 'ai',
        summaryMarkdown: s.summary_markdown,
        sources: s.sources_json,
        summaryDate: s.summary_date,
      };
    }

    const response: NewsResponse = { news };
    res.status(200).json(response);
  } catch (error) {
    console.error('News API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
