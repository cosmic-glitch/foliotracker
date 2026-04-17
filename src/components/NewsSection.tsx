import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { ExternalLink } from 'lucide-react';
import type { Holding } from '../types/portfolio';
import {
  usePortfolioNews,
  type TickerNews,
  type NewsArticle,
  type TickerNewsSource,
} from '../hooks/usePortfolioNews';

interface NewsSectionProps {
  holdings: Holding[];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourceChips({ sources }: { sources: TickerNewsSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s, i) => (
        <a
          key={`${s.url}-${i}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline bg-accent/10 px-2 py-0.5 rounded"
        >
          <ExternalLink className="w-3 h-3" />
          <span>{domainOf(s.url)}</span>
        </a>
      ))}
    </div>
  );
}

function FallbackArticles({ articles }: { articles: NewsArticle[] }) {
  if (articles.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-text-secondary italic">
        AI summary not yet generated; no recent headlines either.
      </div>
    );
  }
  return (
    <div>
      <div className="px-3 py-1 text-xs text-text-secondary italic">
        AI summary not yet generated — showing raw headlines.
      </div>
      {articles.map((article, idx) => (
        <div key={`${article.link}-${idx}`} className="flex items-start gap-2 py-1.5 pl-3 pr-2">
          <span className="flex-1 text-sm text-text-primary line-clamp-2">{article.title}</span>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-sm text-accent hover:underline"
          >
            [More]
          </a>
        </div>
      ))}
    </div>
  );
}

interface TickerCardProps {
  ticker: string;
  name: string;
  news: TickerNews;
}

function TickerCard({ ticker, name, news }: TickerCardProps) {
  return (
    <div className="border border-border rounded-xl px-3 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold bg-accent/10 text-accent px-2 py-0.5 rounded">
            {ticker}
          </span>
          <span className="text-xs text-text-secondary truncate">{name}</span>
        </div>
        {news.kind === 'ai' && (
          <span className="text-[10px] text-text-secondary whitespace-nowrap">
            {news.summaryDate}
          </span>
        )}
      </div>
      {news.kind === 'ai' ? (
        <>
          <div className="prose prose-sm max-w-none prose-p:text-text-primary prose-li:text-text-primary prose-strong:text-text-primary prose-a:text-accent prose-a:no-underline hover:prose-a:underline">
            <ReactMarkdown>{news.summaryMarkdown}</ReactMarkdown>
          </div>
          <SourceChips sources={news.sources} />
        </>
      ) : (
        <FallbackArticles articles={news.articles} />
      )}
    </div>
  );
}

export function NewsSection({ holdings }: NewsSectionProps) {
  const { data, isLoading, error } = usePortfolioNews(holdings);

  const tickerToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holdings) m.set(h.ticker, h.name || h.ticker);
    return m;
  }, [holdings]);

  const orderedTickers = useMemo(() => {
    if (!data?.news) return [];
    return holdings
      .filter(
        (h) =>
          !h.isStatic &&
          (h.instrumentType === 'Common Stock' ||
            h.instrumentType === 'American Depositary Receipt')
      )
      .map((h) => h.ticker)
      .filter((t) => data.news[t]);
  }, [holdings, data?.news]);

  const hasStockHoldings = holdings.some(
    (h) =>
      !h.isStatic &&
      (h.instrumentType === 'Common Stock' ||
        h.instrumentType === 'American Depositary Receipt')
  );

  if (!hasStockHoldings) return null;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-3">
        {isLoading ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Loading news...</div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">Failed to load news</div>
        ) : orderedTickers.length === 0 ? (
          <div className="px-3 py-4 text-center text-text-secondary text-sm">
            No recent news for your holdings
          </div>
        ) : (
          <div className="space-y-3">
            {orderedTickers.map((ticker) => (
              <TickerCard
                key={ticker}
                ticker={ticker}
                name={tickerToName.get(ticker) || ticker}
                news={data!.news[ticker]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
