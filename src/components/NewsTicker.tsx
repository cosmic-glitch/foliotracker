import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { usePortfolioNews } from '../hooks/usePortfolioNews';
import { extractHeadlines } from '../lib/newsHeadline';

const SCROLL_PX_PER_SEC = 90;
const INITIAL_DELAY_MS = 4000;
const DRAG_THRESHOLD_PX = 5;

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
  const oneListWidthRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const startTsRef = useRef<number | null>(null);

  const [userPaused, setUserPaused] = useState(false);
  const userPausedRef = useRef(userPaused);
  useEffect(() => {
    userPausedRef.current = userPaused;
  }, [userPaused]);

  const isHoveringRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const dragMovedRef = useRef(false);
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
      const shouldMove =
        pastInitialDelay &&
        !userPausedRef.current &&
        !isHoveringRef.current &&
        !isDraggingRef.current;

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
    if (!trackRef.current?.contains(e.target as Node)) return;

    isDraggingRef.current = true;
    dragMovedRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = offsetRef.current;

    const onMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = ev.clientX - dragStartXRef.current;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) dragMovedRef.current = true;
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
      isDraggingRef.current = false;
      detach();
    };
    detachDragRef.current = detach;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      dragMovedRef.current = false;
    }
  };

  if (tickerOrder.length === 0) return null;
  if (headlines.length === 0) return null;

  const renderEntries = (keyPrefix: string) =>
    headlines.map((h, i) => (
      <a
        key={`${keyPrefix}-${i}`}
        href={h.url}
        target="_blank"
        rel="noopener noreferrer"
        draggable={false}
        className="inline-flex items-center gap-2 px-3 text-sm whitespace-nowrap hover:text-accent select-none"
      >
        <span className="font-semibold text-text-primary">{h.ticker}</span>
        <span className="text-text-secondary">{h.text}</span>
        <span className="text-text-secondary/40 px-1" aria-hidden="true">•</span>
      </a>
    ));

  return (
    <div
      className="relative overflow-hidden py-1 md:py-2 pr-8"
      onMouseEnter={() => {
        isHoveringRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveringRef.current = false;
      }}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
    >
      <div
        ref={trackRef}
        className="marquee-track flex w-max cursor-grab active:cursor-grabbing"
      >
        {renderEntries('a')}
        {renderEntries('b')}
      </div>
      <button
        type="button"
        aria-label={userPaused ? 'Resume news ticker' : 'Pause news ticker'}
        onClick={(e) => {
          e.stopPropagation();
          setUserPaused((p) => !p);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 z-10 rounded-full p-1 text-text-secondary/60 hover:text-accent hover:bg-card focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {userPaused ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M4 2.5v11l9-5.5z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="4" y="2.5" width="3" height="11" />
            <rect x="9" y="2.5" width="3" height="11" />
          </svg>
        )}
      </button>
    </div>
  );
}
