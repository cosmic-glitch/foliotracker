import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';
import { extractHeadlines } from '../lib/newsHeadline';

const SCROLL_PX_PER_SEC = 90;

interface NewsTickerProps {
  holdings: Holding[];
}

interface TickerHeadline {
  ticker: string;
  text: string;
  url: string;
  sortKey?: number;
}

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
    const collected: Array<TickerHeadline & { order: number }> = [];

    for (const ticker of tickerOrder) {
      const entry = data.news[ticker];
      if (!entry || entry.kind !== 'ai') continue;
      for (const h of extractHeadlines(entry.summaryMarkdown)) {
        collected.push({
          ticker,
          text: h.text,
          url: h.url,
          sortKey: h.sortKey,
          order: collected.length,
        });
      }
    }

    collected.sort((a, b) => {
      const aHas = a.sortKey !== undefined;
      const bHas = b.sortKey !== undefined;
      if (aHas && bHas) {
        if (b.sortKey! !== a.sortKey!) return b.sortKey! - a.sortKey!;
        return a.order - b.order;
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return a.order - b.order;
    });

    return collected.map(({ ticker, text, url, sortKey }) => ({ ticker, text, url, sortKey }));
  }, [data?.news, tickerOrder]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || headlines.length === 0) return;
    const measure = () => {
      const oneListWidth = el.scrollWidth / 2;
      if (oneListWidth > 0) {
        setDurationSeconds(oneListWidth / SCROLL_PX_PER_SEC);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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
    <div className="relative overflow-hidden py-1 md:py-2">
      <div
        ref={trackRef}
        className="marquee-track flex w-max"
        style={
          durationSeconds != null
            ? { ['--marquee-duration' as string]: `${durationSeconds}s` }
            : undefined
        }
      >
        {renderEntries('a')}
        {renderEntries('b')}
      </div>
    </div>
  );
}
