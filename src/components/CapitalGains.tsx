import { useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { formatChange } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

interface CapitalGainsProps {
  holdings: Holding[];
}

export function CapitalGains({ holdings }: CapitalGainsProps) {
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const gainHoldings = consolidatedHoldings.filter((h) => h.profitLoss !== null);

  if (gainHoldings.length === 0) return null;

  const sorted = [...gainHoldings].sort((a, b) => (b.profitLoss ?? 0) - (a.profitLoss ?? 0));

  const totalProfitLoss = gainHoldings.reduce((sum, h) => sum + (h.profitLoss ?? 0), 0);
  const totalCostBasis = gainHoldings.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalPercent = totalCostBasis !== 0 ? (totalProfitLoss / totalCostBasis) * 100 : 0;
  const isTotalPositive = totalProfitLoss >= 0;
  const totalColor = isTotalPositive ? 'text-positive' : 'text-negative';

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-text-primary">Capital Gains</h2>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">Asset</th>
              <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">Gain/Loss</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => {
              const isPositive = (h.profitLoss ?? 0) >= 0;
              const color = isPositive ? 'text-positive' : 'text-negative';
              return (
                <tr key={h.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2 font-semibold text-text-primary">{h.ticker}</td>
                  <td className={`text-right px-4 py-2 ${color} font-medium`}>
                    {formatChange(h.profitLoss!, true)} <span className="opacity-75">({isPositive ? '+' : ''}{h.profitLossPercent!.toFixed(1)}%)</span>
                  </td>
                </tr>
              );
            })}
            {/* Total Row */}
            <tr className="border-t border-border bg-card-hover">
              <td className="px-4 py-2 font-bold text-text-primary">Total</td>
              <td className={`text-right px-4 py-2 ${totalColor} font-bold`}>
                {formatChange(totalProfitLoss, true)} <span className="opacity-75">({isTotalPositive ? '+' : ''}{totalPercent.toFixed(1)}%)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-border">
        {sorted.map((h) => {
          const isPositive = (h.profitLoss ?? 0) >= 0;
          const color = isPositive ? 'text-positive' : 'text-negative';
          return (
            <div key={h.ticker} className="px-3 py-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-text-primary">{h.ticker}</span>
                <span className={`text-sm font-medium ${color}`}>
                  {formatChange(h.profitLoss!, true)} <span className="opacity-75">({isPositive ? '+' : ''}{h.profitLossPercent!.toFixed(1)}%)</span>
                </span>
              </div>
            </div>
          );
        })}
        {/* Total Row */}
        <div className="px-3 py-2 bg-card-hover">
          <div className="flex justify-between items-center">
            <span className="font-bold text-text-primary">Total</span>
            <span className={`text-sm font-bold ${totalColor}`}>
              {formatChange(totalProfitLoss, true)} <span className="opacity-75">({isTotalPositive ? '+' : ''}{totalPercent.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
