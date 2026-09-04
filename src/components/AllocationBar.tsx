import { useLayoutEffect, useRef, useState } from 'react';

// Narrowest bar (px) that can hold a "19.4%"-style label plus padding.
// Decided in pixels, not percent, because the same component sits in the
// wide Allocations tab and in ~150px compare-table cells — a 20%-wide bar
// fits the label in one and overflows it in the other.
const LABEL_MIN_PX = 52;

export function AllocationBar({ percent, maxPercent }: { percent: number; maxPercent: number }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (Math.abs(percent) / maxPercent) * 100 : 0;
  const isNegative = percent < 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setTrackPx(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Until measured, fall back to the percent rule so SSR/first paint is sane.
  const labelInside = trackPx > 0 ? (scaledWidth / 100) * trackPx >= LABEL_MIN_PX : scaledWidth >= 20;

  return (
    <div className="flex items-center">
      <div ref={trackRef} className="flex-1 flex items-center gap-1 min-w-0">
        <div
          className={`h-5 rounded transition-all duration-500 flex items-center justify-end px-1.5 overflow-hidden ${isNegative ? 'bg-negative/80' : 'bg-accent/80'}`}
          style={{ width: `${scaledWidth}%` }}
        >
          {labelInside && (
            <span className="text-xs font-medium text-white/90 whitespace-nowrap">{percent.toFixed(1)}%</span>
          )}
        </div>
        {!labelInside && (
          <span className={`text-xs font-medium whitespace-nowrap ${isNegative ? 'text-negative' : 'text-text-secondary'}`}>{percent.toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}
