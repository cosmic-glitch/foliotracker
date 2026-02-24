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
  const maxAllocation = Math.max(...consolidatedHoldings.map((h) => h.allocation));

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">By Holding</h2>
        </div>
        <div className="p-3 space-y-2">
          {consolidatedHoldings.map((holding) => (
            <div key={holding.ticker} className="flex items-center gap-3 px-1">
              <span className="font-medium text-text-primary text-sm w-16 shrink-0">{holding.ticker}</span>
              <div className="flex-1 min-w-0">
                <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} compact />
              </div>
            </div>
          ))}
        </div>
      </div>

      <HoldingsByType holdings={holdings} />
    </div>
  );
}
