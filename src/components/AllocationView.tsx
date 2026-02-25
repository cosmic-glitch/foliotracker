import { useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { HoldingsByType } from './HoldingsByType';
import { AllocationBar } from './AllocationBar';

interface AllocationViewProps {
  holdings: Holding[];
}

export function AllocationView({ holdings }: AllocationViewProps) {
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  // Sort purely by value for allocation view (no static/non-static grouping)
  const byValue = useMemo(() => [...consolidatedHoldings].sort((a, b) => b.value - a.value), [consolidatedHoldings]);
  const maxAllocation = Math.max(...byValue.map((h) => h.allocation));
  const maxTickerLength = Math.max(...byValue.map((h) => h.ticker.length));

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">By Holding</h2>
        </div>
        <div className="p-3 space-y-0.5">
          {byValue.map((holding) => (
            <div key={holding.ticker} className="flex items-center gap-1.5 px-1">
              <span className="font-medium text-text-primary text-sm shrink-0 whitespace-nowrap" style={{ minWidth: `${maxTickerLength}ch` }}>{holding.ticker}</span>
              <div className="flex-1 min-w-0">
                <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} value={holding.value} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <HoldingsByType holdings={holdings} />
    </div>
  );
}
