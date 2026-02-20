import { useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews, type NewsArticle } from '../hooks/usePortfolioNews';

interface NewsSectionProps {
  holdings: Holding[];
}

interface NewsItemProps {
  article: NewsArticle;
}

function NewsItem({ article }: NewsItemProps) {
  return (
    <div className="flex items-start gap-2 py-1.5 pl-3 pr-2">
      <span className="flex-1 text-sm text-text-primary line-clamp-2">
        {article.title}
      </span>
      <a
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 text-sm text-accent hover:underline"
      >
        [More]
      </a>
    </div>
  );
}

export function NewsSection({ holdings }: NewsSectionProps) {
  const { data, isLoading, error } = usePortfolioNews(holdings);

  // Get grouped news entries (already grouped by ticker from API)
  const tickerEntries = useMemo(() => {
    if (!data?.news) return [];
    return Object.entries(data.news).filter(([, articles]) => articles.length > 0);
  }, [data?.news]);

  // Don't render if no stock holdings
  const hasStockHoldings = holdings.some(
    (h) =>
      !h.isStatic &&
      (h.instrumentType === 'Common Stock' ||
        h.instrumentType === 'American Depositary Receipt')
  );

  if (!hasStockHoldings) {
    return null;
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-2">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            Loading news...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            Failed to load news
          </div>
        ) : tickerEntries.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            No recent news for your holdings
          </div>
        ) : (
          <div className="space-y-3">
            {tickerEntries.map(([ticker, articles]) => (
              <div key={ticker}>
                <div className="px-3 py-1">
                  <span className="text-xs font-semibold bg-accent/10 text-accent px-2 py-0.5 rounded">
                    {ticker}
                  </span>
                </div>
                <div className="ml-2">
                  {articles.map((article, index) => (
                    <NewsItem key={`${ticker}-${index}`} article={article} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
