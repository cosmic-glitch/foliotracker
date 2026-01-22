import { useQuery } from '@tanstack/react-query';
import type { Holding } from '../types/portfolio';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface NewsArticle {
  title: string;
  link: string;
}

interface NewsResponse {
  news: Record<string, NewsArticle[]>;
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
  // Filter to Common Stock and ADRs only (individual stocks)
  const tickers = holdings
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
    staleTime: 15 * 60 * 1000, // 15 min cache
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    enabled: tickers.length > 0,
    refetchOnWindowFocus: false,
  });
}
