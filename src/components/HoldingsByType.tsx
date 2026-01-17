import { useState } from 'react';
import type { Holding } from '../types/portfolio';
import { formatCurrency, formatPercent } from '../utils/formatters';
import { TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';

interface HoldingsByTypeProps {
  holdings: Holding[];
}

// Map instrument types from API to display categories
const TYPE_CATEGORY_MAP: Record<string, { name: string; color: string }> = {
  'Common Stock': { name: 'Stocks', color: '#8b5cf6' }, // purple
  'American Depositary Receipt': { name: 'Stocks', color: '#8b5cf6' }, // ADRs like TSM
  'ETF': { name: 'Equity Funds', color: '#3b82f6' }, // blue
  'Mutual Fund': { name: 'Equity Funds', color: '#3b82f6' }, // blue
  'Bond ETF': { name: 'Bond Funds', color: '#06b6d4' }, // cyan
  'Bond Mutual Fund': { name: 'Bond Funds', color: '#06b6d4' }, // cyan
  'Cash': { name: 'Cash / T-Bills', color: '#22c55e' }, // green
  'Real Estate': { name: 'Real Estate', color: '#f59e0b' }, // amber
  'Crypto': { name: 'Crypto', color: '#f97316' }, // orange
  'Bonds': { name: 'Bonds', color: '#06b6d4' }, // cyan (static bonds)
  'Other': { name: 'Other', color: '#6b7280' }, // gray
};

function ChangeIndicator({ value, percent }: { value: number; percent: number }) {
  if (value === 0) {
    return (
      <span className="text-text-secondary text-sm w-16 text-right">--</span>
    );
  }

  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? 'text-positive' : 'text-negative';

  return (
    <span className={`flex items-center justify-end gap-1 text-sm w-16 ${color}`}>
      <Icon className="w-3 h-3" />
      {formatPercent(percent)}
    </span>
  );
}

interface CategoryData {
  name: string;
  value: number;
  dayChange: number;
  dayChangePercent: number;
  allocation: number;
  color: string;
  holdings: Holding[];
}

function HoldingsBreakdown({ holdings, categoryValue }: { holdings: Holding[]; categoryValue: number }) {
  const sortedHoldings = [...holdings].sort((a, b) => b.value - a.value);

  return (
    <div className="mt-2 mb-1 ml-1 space-y-1.5">
      {sortedHoldings.map((holding) => {
        const categoryPercent = categoryValue > 0 ? (holding.value / categoryValue) * 100 : 0;

        return (
          <div
            key={holding.ticker}
            className="flex justify-between items-center py-1.5 px-2 bg-background rounded-lg text-sm"
          >
            <span className="font-medium text-text-primary">{holding.ticker}</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-text-secondary">
                {formatCurrency(holding.value, true)}
              </span>
              <span className="text-text-secondary w-12 text-right">
                {categoryPercent.toFixed(1)}%
              </span>
              <ChangeIndicator value={holding.dayChange} percent={holding.dayChangePercent} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HoldingsByType({ holdings }: HoldingsByTypeProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  // Group holdings by their display category (e.g., ETF + Mutual Fund become "Equity Funds")
  const categoryTotals = new Map<string, { value: number; dayChange: number; color: string; holdings: Holding[] }>();

  for (const holding of holdings) {
    const typeInfo = TYPE_CATEGORY_MAP[holding.instrumentType] || TYPE_CATEGORY_MAP['Other'];
    const categoryName = typeInfo.name;

    const existing = categoryTotals.get(categoryName) || { value: 0, dayChange: 0, color: typeInfo.color, holdings: [] };
    categoryTotals.set(categoryName, {
      value: existing.value + holding.value,
      dayChange: existing.dayChange + holding.dayChange,
      color: typeInfo.color,
      holdings: [...existing.holdings, holding],
    });
  }

  const typeData: CategoryData[] = Array.from(categoryTotals.entries()).map(([name, data]) => {
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
      holdings: data.holdings,
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
          const isExpanded = expandedCategories.has(type.name);
          const holdingCount = type.holdings.length;

          return (
            <div key={type.name} className="space-y-1">
              <button
                onClick={() => toggleCategory(type.name)}
                className="w-full text-left hover:bg-background/50 rounded-lg p-1 -m-1 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-2">
                    <ChevronDown
                      className={`w-4 h-4 mt-1 text-text-secondary transition-transform duration-200 ${
                        isExpanded ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                    <div>
                      <p className="font-medium text-text-primary">{type.name}</p>
                      <p className="text-sm text-text-secondary">
                        {formatCurrency(type.value, true)}
                        <span className="ml-1 text-text-secondary/70">
                          ({holdingCount} {holdingCount === 1 ? 'holding' : 'holdings'})
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-text-primary">
                      {type.allocation.toFixed(1)}%
                    </p>
                    <ChangeIndicator value={type.dayChange} percent={type.dayChangePercent} />
                  </div>
                </div>
              </button>
              <div className="h-2 bg-background rounded-full overflow-hidden ml-6">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: type.color
                  }}
                />
              </div>
              {isExpanded && (
                <div className="ml-6">
                  <HoldingsBreakdown holdings={type.holdings} categoryValue={type.value} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
