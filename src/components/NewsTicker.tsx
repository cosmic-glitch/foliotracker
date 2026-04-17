import { useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';
import { extractHeadlines } from '../lib/newsHeadline';

interface NewsTickerProps {
  holdings: Holding[];
}

interface TickerHeadline {
  ticker: string;
  text: string;
  url: string;
}

const PER_TICKER_LIMIT = 2;

export function NewsTicker({ holdings }: NewsTickerProps) {
  const { data } = usePortfolioNews(holdings);

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

  const headlines = useMemo<TickerHeadline[]>(() => {
    if (!data?.news) return [];
    const perTicker: Array<TickerHeadline[]> = [];

    for (const ticker of tickerOrder) {
      const entry = data.news[ticker];
      if (!entry || entry.kind !== 'ai') continue;
      const extracted = extractHeadlines(entry.summaryMarkdown).slice(0, PER_TICKER_LIMIT);
      if (extracted.length > 0) {
        perTicker.push(extracted.map((h) => ({ ticker, text: h.text, url: h.url })));
      }
    }

    const out: TickerHeadline[] = [];
    let added = true;
    for (let i = 0; added; i++) {
      added = false;
      for (const bucket of perTicker) {
        if (bucket[i]) {
          out.push(bucket[i]);
          added = true;
        }
      }
    }
    return out;
  }, [data?.news, tickerOrder]);

  const durationSeconds = useMemo(() => {
    const chars = headlines.reduce((n, h) => n + h.ticker.length + h.text.length + 4, 0);
    const perChar = 0.08;
    return Math.max(25, Math.min(120, Math.round(chars * perChar)));
  }, [headlines]);

  if (tickerOrder.length === 0) return null;
  if (headlines.length === 0) return null;

  const renderEntries = (keyPrefix: string) =>
    headlines.map((h, i) => (
      <a
        key={`${keyPrefix}-${i}`}
        href={h.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-3 text-sm whitespace-nowrap hover:text-accent"
      >
        <span className="font-semibold text-text-primary">{h.ticker}</span>
        <span className="text-text-secondary">{h.text}</span>
        <span className="text-text-secondary/40 px-1" aria-hidden="true">•</span>
      </a>
    ));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/80">
      <div
        className="marquee-track flex w-max py-2"
        style={{ ['--marquee-duration' as string]: `${durationSeconds}s` }}
      >
        {renderEntries('a')}
        {renderEntries('b')}
      </div>
    </div>
  );
}
