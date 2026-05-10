import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';

interface NewsSectionProps {
  holdings: Holding[];
  // Render a panel header above the news list. Used in the allocation-only
  // share view where the news appears alongside the allocation breakdown
  // (no tab bar to label it).
  title?: string;
}

const NO_MATERIAL_NEWS_SENTINEL = 'No material news in the last 7 days.';

export function NewsSection({ holdings, title }: NewsSectionProps) {
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
    const rows: Array<{ ticker: string; kind: 'ai' | 'pending'; markdown?: string }> = [];
    for (const ticker of tickerOrder) {
      const entry = data.news[ticker];
      if (!entry) {
        rows.push({ ticker, kind: 'pending' });
        continue;
      }
      if (entry.kind === 'ai') {
        const body = entry.summaryMarkdown.trim();
        if (body === NO_MATERIAL_NEWS_SENTINEL || body.length === 0) continue;
        rows.push({ ticker, kind: 'ai', markdown: body });
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
      {title && (
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        </div>
      )}
      <div className="p-3">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Loading news...</div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Failed to load news</div>
        ) : renderedRows.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            No material news in the last 7 days.
          </div>
        ) : (
          <div>
            {latestSummaryDate && (
              <div className="px-3 pb-2 text-[11px] text-text-secondary">
                Last updated: {latestSummaryDate}
              </div>
            )}
            <div className="px-3 space-y-4">
              {renderedRows.map((row) =>
                row.kind === 'ai' ? (
                  <div key={row.ticker}>
                    <div className="text-sm font-semibold text-text-primary mb-1">
                      {row.ticker}
                    </div>
                    <div className="text-sm text-text-primary prose prose-sm max-w-none prose-ul:my-0 prose-li:my-0.5 prose-p:my-0 prose-strong:text-text-primary prose-a:text-accent prose-a:no-underline hover:prose-a:underline marker:text-text-secondary">
                      <ReactMarkdown>{row.markdown!}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div key={row.ticker} className="opacity-60">
                    <div className="text-sm font-semibold text-text-primary mb-1">
                      {row.ticker}
                    </div>
                    <div className="text-sm italic text-text-secondary pl-1">
                      summary pending
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
