import { Fragment, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
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

function AllocationBar({ percent, maxPercent }: { percent: number; maxPercent: number }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-background rounded-full overflow-hidden">
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

function ProfitIndicator({ value, percent }: { value: number | null; percent: number | null }) {
  if (value === null || percent === null) {
    return <span className="text-text-secondary">--</span>;
  }

  const isPositive = value >= 0;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <div className={`flex flex-col items-end ${color}`}>
      <span className="font-medium">{formatChange(value, true)}</span>
      <span className="text-sm opacity-75">{isPositive ? '+' : ''}{percent.toFixed(1)}%</span>
    </div>
  );
}

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const maxAllocation = Math.max(...consolidatedHoldings.map((h) => h.allocation));
  const hasAnyGainLoss = consolidatedHoldings.some((h) => h.profitLoss != null);
  const hasAnyFundamentals = consolidatedHoldings.some(
    (h) => h.revenue != null || h.earnings != null || h.forwardPE != null || h.pctTo52WeekHigh != null || h.operatingMargin != null || h.revenueGrowth3Y != null || h.epsGrowth3Y != null
  );

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-text-primary">Holdings</h2>
      </div>

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
              {hasAnyGainLoss && (
                <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">
                  Gain/Loss
                </th>
              )}
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
                <Fragment key={holding.ticker}>
                  <tr
                    className="border-b border-border last:border-0 hover:bg-card-hover transition-colors"
                    style={holdingHasFundamentals ? { borderBottom: 'none' } : undefined}
                  >
                    <td className="px-4 py-2">
                      <p className="font-semibold text-text-primary">{holding.ticker}</p>
                    </td>
                    <td className="text-right px-4 py-2">
                      <span className="font-semibold text-text-primary">
                        {formatCurrency(holding.value, true)}
                      </span>
                    </td>
                    {hasAnyGainLoss && (
                      <td className="text-right px-4 py-2">
                        <ProfitIndicator value={holding.profitLoss} percent={holding.profitLossPercent} />
                      </td>
                    )}
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
                  {holdingHasFundamentals && (
                    <tr className="border-b border-border last:border-0">
                      <td colSpan={hasAnyGainLoss ? 5 : 4} className="px-4 pb-2 pt-0">
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>Rev: {formatLargeValue(holding.revenue)}</span>
                          <span>Earn: {formatLargeValue(holding.earnings)}</span>
                          <span>FwdPE: {formatPERatio(holding.forwardPE)}</span>
                          <span>OpMgn: {formatMarginOrGrowth(holding.operatingMargin)}</span>
                          <span>Rev3Y: {formatMarginOrGrowth(holding.revenueGrowth3Y)}</span>
                          <span>EPS3Y: {formatMarginOrGrowth(holding.epsGrowth3Y)}</span>
                          <span className={holding.pctTo52WeekHigh != null && holding.pctTo52WeekHigh > 0 ? 'text-negative' : ''}>
                            52wk: {formatPctTo52WeekHigh(holding.pctTo52WeekHigh)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-border">
        {consolidatedHoldings.map((holding) => (
          <div key={holding.ticker} className="p-3">
            <div className="flex justify-between items-start mb-2">
              <p className="font-semibold text-text-primary">{holding.ticker}</p>
              <span className="font-semibold text-text-primary">
                {formatCurrency(holding.value, true)}
              </span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex-1 mr-4">
                <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} />
              </div>
            </div>
            <div className="flex justify-between items-center text-sm">
              {hasAnyGainLoss && (
                <div className="flex items-center gap-1">
                  <span className="text-text-secondary">Gain/Loss:</span>
                  <ProfitIndicator value={holding.profitLoss} percent={holding.profitLossPercent} />
                </div>
              )}
              <div className={hasAnyGainLoss ? '' : 'ml-auto'}>
                <ChangeIndicator
                  value={holding.dayChange}
                  percent={holding.dayChangePercent}
                />
              </div>
            </div>
            {!holding.isStatic && hasAnyFundamentals && (holding.revenue != null || holding.earnings != null || holding.forwardPE != null || holding.pctTo52WeekHigh != null || holding.operatingMargin != null || holding.revenueGrowth3Y != null || holding.epsGrowth3Y != null) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary mt-2 pt-2 border-t border-border">
                <span>Rev: {formatLargeValue(holding.revenue)}</span>
                <span>Earn: {formatLargeValue(holding.earnings)}</span>
                <span>FwdPE: {formatPERatio(holding.forwardPE)}</span>
                <span>OpMgn: {formatMarginOrGrowth(holding.operatingMargin)}</span>
                <span>Rev3Y: {formatMarginOrGrowth(holding.revenueGrowth3Y)}</span>
                <span>EPS3Y: {formatMarginOrGrowth(holding.epsGrowth3Y)}</span>
                <span className={holding.pctTo52WeekHigh != null && holding.pctTo52WeekHigh > 0 ? 'text-negative' : ''}>
                  52wk: {formatPctTo52WeekHigh(holding.pctTo52WeekHigh)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
