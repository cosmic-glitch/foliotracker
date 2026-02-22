import { useState, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { Info } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent, formatLargeValue, formatPERatio, formatPctTo52WeekHigh, formatMarginOrGrowth } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

interface HoldingsTableProps {
  holdings: Holding[];
}

function ChangeIndicator({ value, percent }: { value: number; percent: number }) {
  if (value === 0) {
    return <span className="text-text-secondary">--</span>;
  }

  const isPositive = value >= 0;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <div className={`flex flex-col items-end ${color}`}>
      <span className="font-medium">{formatChange(value, true)}</span>
      <span className="text-sm opacity-75">{formatPercent(percent)}</span>
    </div>
  );
}

function AllocationBar({ percent, maxPercent, compact }: { percent: number; maxPercent: number; compact?: boolean }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 ${compact ? 'h-2' : 'h-3'} bg-background rounded-full overflow-hidden`}>
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${scaledWidth}%` }}
        />
      </div>
      <span className="text-text-secondary text-sm w-14 text-right">
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const maxAllocation = Math.max(...consolidatedHoldings.map((h) => h.allocation));
  const [popover, setPopover] = useState<{ ticker: string; top: number; left: number } | null>(null);
  const popoverHolding = popover ? consolidatedHoldings.find(h => h.ticker === popover.ticker) : null;

  const openPopover = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ ticker, top: rect.bottom + 4, left: rect.left });
  };
  const hasAnyFundamentals = consolidatedHoldings.some(
    (h) => h.revenue != null || h.earnings != null || h.forwardPE != null || h.pctTo52WeekHigh != null || h.operatingMargin != null || h.revenueGrowth3Y != null || h.epsGrowth3Y != null
  );

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                Asset
              </th>
              <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">
                Value
              </th>

              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2 w-72">
                Allocation
              </th>
              <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">
                Day Change
              </th>
            </tr>
          </thead>
          <tbody>
            {consolidatedHoldings.map((holding) => {
              const holdingHasFundamentals = !holding.isStatic && hasAnyFundamentals && (holding.revenue != null || holding.earnings != null || holding.forwardPE != null || holding.pctTo52WeekHigh != null || holding.operatingMargin != null || holding.revenueGrowth3Y != null || holding.epsGrowth3Y != null);
              return (
                <tr key={holding.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-text-primary">{holding.ticker}</p>
                      {holdingHasFundamentals && (
                        <button onClick={(e) => openPopover(holding.ticker, e)} className="text-text-secondary hover:text-text-primary transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="text-right px-4 py-2">
                    <span className="font-semibold text-text-primary">
                      {formatCurrency(holding.value, true)}
                    </span>
                  </td>

                  <td className="px-4 py-2">
                    <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} />
                  </td>
                  <td className="text-right px-4 py-2">
                    <ChangeIndicator
                      value={holding.dayChange}
                      percent={holding.dayChangePercent}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-border">
        {consolidatedHoldings.map((holding) => {
          const holdingHasFundamentals = !holding.isStatic && hasAnyFundamentals && (holding.revenue != null || holding.earnings != null || holding.forwardPE != null || holding.pctTo52WeekHigh != null || holding.operatingMargin != null || holding.revenueGrowth3Y != null || holding.epsGrowth3Y != null);
          return (
            <div key={holding.ticker} className="px-3 py-2">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-text-primary">{holding.ticker}</p>
                  {holdingHasFundamentals && (
                    <button onClick={(e) => openPopover(holding.ticker, e)} className="text-text-secondary hover:text-text-primary transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {holding.dayChange !== 0 ? (
                    <span className={`text-sm ${holding.dayChange >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {formatChange(holding.dayChange, true)} ({formatPercent(holding.dayChangePercent)})
                    </span>
                  ) : (
                    <span className="text-sm text-text-secondary">--</span>
                  )}
                  <span className="font-semibold text-text-primary">
                    {formatCurrency(holding.value, true)}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center gap-3">
                <div className="flex-1 min-w-0">
                  <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} compact />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {popover && popoverHolding && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-64"
            style={{ top: popover.top, left: popover.left }}
          >
            <p className="font-semibold text-text-primary text-sm mb-2">{popover.ticker}</p>
            <div className="grid grid-cols-1 gap-y-1 text-xs">
              {popoverHolding.revenue != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Revenue</span>
                  <span className="font-medium text-text-primary">{formatLargeValue(popoverHolding.revenue)}</span>
                </div>
              )}
              {popoverHolding.earnings != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Earnings</span>
                  <span className="font-medium text-text-primary">{formatLargeValue(popoverHolding.earnings)}</span>
                </div>
              )}
              {popoverHolding.forwardPE != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Forward P/E</span>
                  <span className="font-medium text-text-primary">{formatPERatio(popoverHolding.forwardPE)}</span>
                </div>
              )}
              {popoverHolding.operatingMargin != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Operating Margin</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverHolding.operatingMargin)}</span>
                </div>
              )}
              {popoverHolding.revenueGrowth3Y != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Revenue Growth (3Y)</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverHolding.revenueGrowth3Y)}</span>
                </div>
              )}
              {popoverHolding.epsGrowth3Y != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">EPS Growth (3Y)</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverHolding.epsGrowth3Y)}</span>
                </div>
              )}
              {popoverHolding.pctTo52WeekHigh != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">% to 52-Wk High</span>
                  <span className={`font-medium ${popoverHolding.pctTo52WeekHigh > 0 ? 'text-negative' : 'text-positive'}`}>{formatPctTo52WeekHigh(popoverHolding.pctTo52WeekHigh)}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
