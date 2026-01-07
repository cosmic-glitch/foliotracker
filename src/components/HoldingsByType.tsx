import type { Holding } from '../types/portfolio';
import { formatCurrency, formatPercent } from '../utils/formatters';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface HoldingsByTypeProps {
  holdings: Holding[];
}

// Map instrument types from API to display categories
const TYPE_CATEGORY_MAP: Record<string, { name: string; color: string }> = {
  'Common Stock': { name: 'Stocks', color: '#8b5cf6' }, // purple
  'American Depositary Receipt': { name: 'Stocks', color: '#8b5cf6' }, // ADRs like TSM
  'ETF': { name: 'Funds', color: '#3b82f6' }, // blue
  'Mutual Fund': { name: 'Funds', color: '#3b82f6' }, // blue (same as ETF)
  'Cash': { name: 'Cash / T-Bills', color: '#22c55e' }, // green
  'Real Estate': { name: 'Real Estate', color: '#f59e0b' }, // amber
  'Crypto': { name: 'Crypto', color: '#f97316' }, // orange
  'Bonds': { name: 'Bonds', color: '#06b6d4' }, // cyan
  'Other': { name: 'Other', color: '#6b7280' }, // gray
};

function ChangeIndicator({ value, percent }: { value: number; percent: number }) {
  if (value === 0) {
    return (
      <span className="text-text-secondary text-sm">--</span>
    );
  }

  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <span className={`flex items-center gap-1 text-sm ${color}`}>
      <Icon className="w-3 h-3" />
      {formatPercent(percent)}
    </span>
  );
}

export function HoldingsByType({ holdings }: HoldingsByTypeProps) {
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  // Group holdings by their display category (ETF + Mutual Fund both become "Funds")
  const categoryTotals = new Map<string, { value: number; dayChange: number; color: string }>();

  for (const holding of holdings) {
    const typeInfo = TYPE_CATEGORY_MAP[holding.instrumentType] || TYPE_CATEGORY_MAP['Other'];
    const categoryName = typeInfo.name;

    const existing = categoryTotals.get(categoryName) || { value: 0, dayChange: 0, color: typeInfo.color };
    categoryTotals.set(categoryName, {
      value: existing.value + holding.value,
      dayChange: existing.dayChange + holding.dayChange,
      color: typeInfo.color,
    });
  }

  const typeData = Array.from(categoryTotals.entries()).map(([name, data]) => {
    const previousValue = data.value - data.dayChange;
    const dayChangePercent = previousValue > 0 ? (data.dayChange / previousValue) * 100 : 0;
    const allocation = totalValue > 0 ? (data.value / totalValue) * 100 : 0;

    return {
      name,
      value: data.value,
      dayChange: data.dayChange,
      dayChangePercent,
      allocation,
      color: data.color,
    };
  }).filter((t) => t.value > 0).sort((a, b) => b.value - a.value);

  const maxAllocation = Math.max(...typeData.map((t) => t.allocation));

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-text-primary">By Type</h2>
      </div>

      <div className="p-3 space-y-3">
        {typeData.map((type) => {
          const barWidth = maxAllocation > 0 ? (type.allocation / maxAllocation) * 100 : 0;

          return (
            <div key={type.name} className="space-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-text-primary">{type.name}</p>
                  <p className="text-sm text-text-secondary">
                    {formatCurrency(type.value, true)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-text-primary">
                    {type.allocation.toFixed(1)}%
                  </p>
                  <ChangeIndicator value={type.dayChange} percent={type.dayChangePercent} />
                </div>
              </div>
              <div className="h-2 bg-background rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: type.color
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
