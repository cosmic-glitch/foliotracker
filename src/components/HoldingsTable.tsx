import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Holding } from '../types/portfolio';
import { formatCurrency, formatChange, formatPercent } from '../utils/formatters';

interface HoldingsTableProps {
  holdings: Holding[];
}

function ChangeIndicator({ value, percent }: { value: number; percent: number }) {
  if (value === 0) {
    return (
      <div className="flex items-center gap-1 text-text-secondary">
        <Minus className="w-4 h-4" />
        <span>--</span>
      </div>
    );
  }

  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <div className={`flex items-center gap-1 ${color}`}>
      <Icon className="w-4 h-4" />
      <span className="font-medium">{formatChange(value, true)}</span>
      <span className="text-sm opacity-75">({formatPercent(percent)})</span>
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
  const maxAllocation = Math.max(...holdings.map((h) => h.allocation));

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
              <th className="text-right text-text-secondary text-sm font-medium px-4 py-2">
                Gain/Loss
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
            {holdings.map((holding) => (
              <tr
                key={holding.ticker}
                className="border-b border-border last:border-0 hover:bg-card-hover transition-colors"
              >
                <td className="px-4 py-2">
                  <div>
                    <p className="font-semibold text-text-primary">{holding.ticker}</p>
                    <p className="text-sm text-text-secondary">{holding.name}</p>
                  </div>
                </td>
                <td className="text-right px-4 py-2">
                  <span className="font-semibold text-text-primary">
                    {formatCurrency(holding.value, true)}
                  </span>
                </td>
                <td className="text-right px-4 py-2">
                  <ProfitIndicator value={holding.profitLoss} percent={holding.profitLossPercent} />
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden divide-y divide-border">
        {holdings.map((holding) => (
          <div key={holding.ticker} className="p-3">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="font-semibold text-text-primary">{holding.ticker}</p>
                <p className="text-sm text-text-secondary">{holding.name}</p>
              </div>
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
              <div className="flex items-center gap-1">
                <span className="text-text-secondary">Gain/Loss:</span>
                <ProfitIndicator value={holding.profitLoss} percent={holding.profitLossPercent} />
              </div>
              <ChangeIndicator
                value={holding.dayChange}
                percent={holding.dayChangePercent}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
