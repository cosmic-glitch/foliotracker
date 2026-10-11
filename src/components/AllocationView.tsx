import { useMemo, useState } from 'react';
import { ChartLine } from 'lucide-react';
import type { Holding } from '../types/portfolio';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { HoldingsByType } from './HoldingsByType';
import { AllocationBar } from './AllocationBar';
import { TickerDetailModal } from './TickerDetailModal';
import { useTickerDetailParam } from '../hooks/useTickerDetailParam';

interface AllocationViewProps {
  holdings: Holding[];
  // When true (allocation-only share viewer), $ fields are zeroed by the
  // server. Use the server-provided `allocation` percentage as the weight.
  hideValues?: boolean;
}

export function AllocationView({ holdings, hideValues = false }: AllocationViewProps) {
  const [excludeStatic, setExcludeStatic] = useState(false);

  const hasStaticHoldings = useMemo(() => holdings.some(h => h.isStatic), [holdings]);

  const filteredHoldings = useMemo(
    () => excludeStatic ? holdings.filter(h => !h.isStatic) : holdings,
    [holdings, excludeStatic]
  );

  const consolidatedHoldings = useMemo(() => consolidateHoldings(filteredHoldings), [filteredHoldings]);

  // Recalculate allocation percentages based on filtered total. In
  // hideValues mode `value` is 0, so use `allocation` as the weight.
  const weightOf = (h: Holding) => (hideValues ? h.allocation : h.value);
  const filteredTotal = consolidatedHoldings.reduce((sum, h) => sum + weightOf(h), 0);
  const byValue = useMemo(() =>
    [...consolidatedHoldings]
      .map(h => ({
        ...h,
        allocation: filteredTotal > 0 ? (weightOf(h) / filteredTotal) * 100 : 0,
      }))
      .sort((a, b) => weightOf(b) - weightOf(a)),
    // weightOf depends only on hideValues, captured here to satisfy the linter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consolidatedHoldings, filteredTotal, hideValues]
  );
  const maxAllocation = Math.max(0, ...byValue.map((h) => Math.abs(h.allocation)));

  // Tickers open the detail panel like the Holdings/CG tabs (`?t=TICKER`;
  // only one tab renders at a time, so the instances don't double up). Not
  // for allocation-only viewers — the server zeroes their prices, so the
  // panel header would read $0. Static holdings have no price series.
  const { openTicker, openDetail, closeDetail } = useTickerDetailParam();
  const tickersLinked = !hideValues;
  const detailHolding = tickersLinked && openTicker
    ? byValue.find((h) => h.ticker === openTicker && !h.isStatic) ?? null
    : null;

  // Label column: wide enough for the longest linked ticker plus its icon, or
  // for a plain (static / unlinked) label capped at 8ch — so a long static
  // name like "Real Estate" truncates instead of widening every row.
  const isLinked = (h: Holding) => tickersLinked && !h.isStatic;
  const longest = (rows: Holding[]) => Math.min(8, Math.max(0, ...rows.map((h) => h.ticker.length)));
  const labelWidth = `max(calc(${longest(byValue.filter(isLinked))}ch + 1rem), ${longest(byValue.filter((h) => !isLinked(h)))}ch)`;

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">By Holding</h2>
          {hasStaticHoldings && (
            <button
              onClick={() => setExcludeStatic(!excludeStatic)}
              className={`text-xs underline transition-colors ${excludeStatic ? 'text-accent hover:text-accent/80' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {excludeStatic ? 'Include Static Holdings' : 'Exclude Static Holdings'}
            </button>
          )}
        </div>
        <div className="p-3 space-y-0.5">
          {byValue.map((holding) => (
            <div key={holding.ticker} className="flex items-center gap-1.5 px-1">
              {/* Fixed width (with room for the icon when linked) so every bar starts at the same x */}
              <span className="font-mono font-medium text-sm shrink-0 whitespace-nowrap" style={{ width: labelWidth }}>
                {isLinked(holding) ? (
                  <button
                    type="button"
                    onClick={() => openDetail(holding.ticker)}
                    className="group/ticker inline-flex items-center gap-1 max-w-full text-accent hover:underline underline-offset-2 decoration-accent/50"
                    title={`${holding.ticker} price history & details`}
                  >
                    <span className="truncate">{holding.ticker}</span>
                    <ChartLine className="w-3 h-3 shrink-0 opacity-60 group-hover/ticker:opacity-100" />
                  </button>
                ) : (
                  <span className="block truncate text-text-primary" title={holding.ticker}>{holding.ticker}</span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <HoldingsByType holdings={filteredHoldings} hideValues={hideValues} />

      {detailHolding && (
        <TickerDetailModal subject={detailHolding} onClose={closeDetail} />
      )}
    </div>
  );
}
