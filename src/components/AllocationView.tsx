import { useMemo, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { HoldingsByType } from './HoldingsByType';
import { AllocationBar } from './AllocationBar';

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
  const maxTickerLength = Math.max(0, ...byValue.map((h) => h.ticker.length));

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
              <span className="font-medium text-text-primary text-sm shrink-0 whitespace-nowrap" style={{ minWidth: `${maxTickerLength}ch` }}>{holding.ticker}</span>
              <div className="flex-1 min-w-0">
                <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <HoldingsByType holdings={filteredHoldings} hideValues={hideValues} />
    </div>
  );
}
