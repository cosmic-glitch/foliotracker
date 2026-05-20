import { useQuery } from '@tanstack/react-query';
import type { Holding } from '../types/portfolio';
import { consolidateHoldings } from '../utils/equivalentTickers';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface NewsArticle {
  title: string;
  link: string;
}

export interface TickerNewsSource {
  title: string;
  url: string;
}

export interface AiSummary {
  kind: 'ai';
  summaryMarkdown: string;
  sources: TickerNewsSource[];
  summaryDate: string;
}

export interface FallbackNews {
  kind: 'fallback';
  articles: NewsArticle[];
}

export type TickerNews = AiSummary | FallbackNews;

interface NewsResponse {
  news: Record<string, TickerNews>;
}

async function fetchNews(tickers: string[]): Promise<NewsResponse> {
  if (tickers.length === 0) {
    return { news: {} };
  }

  const response = await fetch(
    `${API_BASE_URL}/api/news?tickers=${encodeURIComponent(tickers.join(','))}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch news');
  }

  return response.json();
}

export function usePortfolioNews(holdings: Holding[]) {
  // Consolidate equivalent tickers (e.g. GOOG/GOOGL) before fetching news so we
  // don't request duplicate summaries; the canonical ticker is used as the key.
  const tickers = consolidateHoldings(holdings)
    .filter(
      (h) =>
        !h.isStatic &&
        (h.instrumentType === 'Common Stock' ||
          h.instrumentType === 'American Depositary Receipt')
    )
    .map((h) => h.ticker);

  return useQuery({
    queryKey: ['news', ...tickers],
    queryFn: () => fetchNews(tickers),
    staleTime: 6 * 60 * 60 * 1000, // 6 hours — summaries regenerate daily
    gcTime: 12 * 60 * 60 * 1000,
    enabled: tickers.length > 0,
    refetchOnWindowFocus: false,
  });
}
