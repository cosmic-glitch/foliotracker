import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';

interface NewsSectionProps {
  holdings: Holding[];
}

const NO_MATERIAL_NEWS_SENTINEL = 'No material news in the last 2 days.';

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
};

export function NewsSection({ holdings }: NewsSectionProps) {
  const { data, isLoading, error } = usePortfolioNews(holdings);

  const tickerOrder = useMemo(
    () =>
      holdings
        .filter(
          (h) =>
            !h.isStatic &&
            (h.instrumentType === 'Common Stock' ||
              h.instrumentType === 'American Depositary Receipt')
        )
        .map((h) => h.ticker),
    [holdings]
  );

  const hasStockHoldings = tickerOrder.length > 0;

  const renderedRows = useMemo(() => {
    if (!data?.news) return [];
    const rows: Array<{ ticker: string; kind: 'ai' | 'pending'; tweet?: string }> = [];
    for (const ticker of tickerOrder) {
      const entry = data.news[ticker];
      if (!entry) {
        rows.push({ ticker, kind: 'pending' });
        continue;
      }
      if (entry.kind === 'ai') {
        const body = entry.summaryMarkdown.trim();
        if (body === NO_MATERIAL_NEWS_SENTINEL || body.length === 0) continue;
        rows.push({ ticker, kind: 'ai', tweet: body });
      } else {
        rows.push({ ticker, kind: 'pending' });
      }
    }
    return rows;
  }, [data?.news, tickerOrder]);

  const latestSummaryDate = useMemo(() => {
    if (!data?.news) return null;
    let max: string | null = null;
    for (const entry of Object.values(data.news)) {
      if (entry.kind === 'ai' && (!max || entry.summaryDate > max)) {
        max = entry.summaryDate;
      }
    }
    return max;
  }, [data?.news]);

  if (!hasStockHoldings) return null;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-3">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Loading news...</div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Failed to load news</div>
        ) : renderedRows.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            No material news in the last 2 days.
          </div>
        ) : (
          <div>
            {latestSummaryDate && (
              <div className="px-3 pb-2 text-[11px] text-text-secondary">
                Last updated: {latestSummaryDate}
              </div>
            )}
            <ul className="list-disc pl-7 pr-3 space-y-1.5 text-sm text-text-primary marker:text-text-secondary prose-a:text-accent prose-a:no-underline hover:prose-a:underline">
              {renderedRows.map((row) =>
                row.kind === 'ai' ? (
                  <li key={row.ticker}>
                    <strong className="font-semibold">{row.ticker}</strong>:{' '}
                    <ReactMarkdown components={markdownComponents}>
                      {row.tweet!}
                    </ReactMarkdown>
                  </li>
                ) : (
                  <li key={row.ticker} className="opacity-60">
                    <strong className="font-semibold">{row.ticker}</strong>:{' '}
                    <em className="text-text-secondary">summary pending</em>
                  </li>
                )
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
