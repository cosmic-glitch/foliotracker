import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';
import { extractHeadlines } from '../lib/newsHeadline';
import { consolidateHoldings } from '../utils/equivalentTickers';

const SCROLL_PX_PER_SEC = 90;
const INITIAL_DELAY_MS = 4000;

interface NewsTickerProps {
  holdings: Holding[];
}

interface TickerHeadline {
  ticker: string;
  text: string;
  url: string;
  sortKey?: number;
  allocation: number;
}

export function NewsTicker({ holdings }: NewsTickerProps) {
  const { data } = usePortfolioNews(holdings);

  // Consolidate equivalent tickers (GOOG/GOOGL) so a split position rolls up to
  // a single headline source weighted by its true combined allocation.
  const consolidated = useMemo(() => consolidateHoldings(holdings), [holdings]);

  const tickerOrder = useMemo(
    () =>
      consolidated
        .filter(
          (h) =>
            !h.isStatic &&
            (h.instrumentType === 'Common Stock' ||
              h.instrumentType === 'American Depositary Receipt')
        )
        .sort((a, b) => b.allocation - a.allocation) // heaviest holdings first
        .map((h) => h.ticker),
    [consolidated]
  );

  const allocByTicker = useMemo(
    () => new Map(consolidated.map((h) => [h.ticker, h.allocation])),
    [consolidated]
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
          allocation: allocByTicker.get(ticker) ?? 0,
          order: collected.length,
        });
      }
    }

    // Weight-first: the heaviest portfolio holding leads the ticker. Within a
    // stock, newest headline first; `order` keeps same-date headlines in
    // markdown order.
    collected.sort((a, b) => {
      if (b.allocation !== a.allocation) return b.allocation - a.allocation;
      const aHas = a.sortKey !== undefined;
      const bHas = b.sortKey !== undefined;
      if (aHas && bHas && b.sortKey! !== a.sortKey!) return b.sortKey! - a.sortKey!;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.order - b.order;
    });

    return collected.map(({ ticker, text, url, sortKey, allocation }) => ({
      ticker,
      text,
      url,
      sortKey,
      allocation,
    }));
  }, [data?.news, tickerOrder, allocByTicker]);

  const trackRef = useRef<HTMLDivElement>(null);
  const oneListWidthRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  const isPointerDownRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const detachDragRef = useRef<(() => void) | null>(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const applyTransform = useCallback(() => {
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${offsetRef.current}px)`;
    }
  }, []);

  const wrapOffset = useCallback(() => {
    const w = oneListWidthRef.current;
    if (w <= 0) return;
    if (offsetRef.current <= -w) offsetRef.current += w;
    else if (offsetRef.current > 0) offsetRef.current -= w;
  }, []);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || headlines.length === 0) return;
    const measure = () => {
      oneListWidthRef.current = el.scrollWidth / 2;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headlines]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (headlines.length === 0) return;

    const tick = (ts: number) => {
      if (startTsRef.current === null) startTsRef.current = ts;

      const pastInitialDelay = ts - startTsRef.current > INITIAL_DELAY_MS;
      const shouldMove = pastInitialDelay && !isPointerDownRef.current;

      if (shouldMove && lastTsRef.current !== null) {
        const dtSec = (ts - lastTsRef.current) / 1000;
        offsetRef.current -= dtSec * SCROLL_PX_PER_SEC;
      }
      lastTsRef.current = ts;

      wrapOffset();
      applyTransform();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      startTsRef.current = null;
    };
  }, [headlines, prefersReducedMotion, applyTransform, wrapOffset]);

  useEffect(() => () => {
    detachDragRef.current?.();
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    isPointerDownRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = offsetRef.current;

    const onMove = (ev: PointerEvent) => {
      if (!isPointerDownRef.current) return;
      const dx = ev.clientX - dragStartXRef.current;
      offsetRef.current = dragStartOffsetRef.current + dx;
      wrapOffset();
      applyTransform();
    };
    const detach = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      detachDragRef.current = null;
    };
    const onEnd = () => {
      isPointerDownRef.current = false;
      lastTsRef.current = null;
      detach();
    };
    detachDragRef.current = detach;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  if (tickerOrder.length === 0) return null;
  if (headlines.length === 0) return null;

  const renderEntries = (keyPrefix: string) =>
    headlines.map((h, i) => (
      <span
        key={`${keyPrefix}-${i}`}
        className="inline-flex items-center gap-2 px-3 text-sm whitespace-nowrap select-none"
      >
        <span className="font-semibold text-text-primary">{h.ticker}</span>
        <span className="text-text-secondary">{h.text}</span>
        <span className="text-text-secondary/40 px-1" aria-hidden="true">•</span>
      </span>
    ));

  return (
    <div
      className="relative overflow-hidden py-1 md:py-2"
      onPointerDown={onPointerDown}
    >
      <div
        ref={trackRef}
        className="marquee-track flex w-max cursor-grab active:cursor-grabbing"
      >
        {renderEntries('a')}
        {renderEntries('b')}
      </div>
    </div>
  );
}
