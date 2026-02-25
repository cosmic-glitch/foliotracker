import { useState, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { Info } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent, formatPrice, formatLargeValue, formatPERatio, formatPctTo52WeekHigh, formatMarginOrGrowth } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

interface HoldingsTableProps {
  holdings: Holding[];
}

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const maxTickerLength = useMemo(() => Math.max(...consolidatedHoldings.filter((h) => !h.isStatic).map((h) => h.ticker.length)), [consolidatedHoldings]);
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
                Unit Price
              </th>
              <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">
                Holding Size
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
                    {!holding.isStatic ? (
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-text-primary">{formatPrice(holding.currentPrice)}</span>
                        {holding.dayChangePercent !== 0 && (
                          <span className={`text-sm ${holding.dayChangePercent >= 0 ? 'text-positive' : 'text-negative'}`}>({formatPercent(holding.dayChangePercent)})</span>
                        )}
                      </div>
                    ) : (
                      <span />
                    )}
                  </td>
                  <td className="text-right px-4 py-2">
                    <div className="flex flex-col items-end">
                      <span className="font-semibold text-text-primary">
                        {formatCurrency(holding.value, true)}
                      </span>
                      {!holding.isStatic && holding.dayChange !== 0 && (
                        <span className={`text-sm ${holding.dayChange >= 0 ? 'text-positive' : 'text-negative'}`}>
                          ({formatChange(holding.dayChange, true)})
                        </span>
                      )}
                    </div>
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
              <div className="flex items-center gap-2">
                {/* Left: ticker + info */}
                <div className="flex items-center gap-1 shrink-0" style={{ minWidth: `${maxTickerLength + 4}ch` }}>
                  <p className="font-semibold text-text-primary">{holding.ticker}</p>
                  {holdingHasFundamentals && (
                    <button onClick={(e) => openPopover(holding.ticker, e)} className="text-text-secondary hover:text-text-primary transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Middle: unit price + % change */}
                {!holding.isStatic ? (
                  <div className="flex-1 text-left">
                    <span className="text-text-primary text-sm">{formatPrice(holding.currentPrice)}</span>
                    {holding.dayChangePercent !== 0 && (
                      <span className={`text-xs ml-1 ${holding.dayChangePercent >= 0 ? 'text-positive' : 'text-negative'}`}>{formatPercent(holding.dayChangePercent)}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {/* Right: value + $ change */}
                <div className="flex-1 text-left">
                  <span className="font-semibold text-text-primary">{formatCurrency(holding.value, true)}</span>
                  {!holding.isStatic && holding.dayChange !== 0 && (
                    <span className={`text-xs ml-1 ${holding.dayChange >= 0 ? 'text-positive' : 'text-negative'}`}>{formatChange(holding.dayChange, true)}</span>
                  )}
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
                  <span className="text-text-secondary">% to 52wk high</span>
                  <span className="font-medium text-text-primary">{formatPctTo52WeekHigh(popoverHolding.pctTo52WeekHigh)}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
