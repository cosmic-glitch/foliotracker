import { useState, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { formatCurrency, formatPercent } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';

interface HoldingsByTypeProps {
  holdings: Holding[];
}

// Map instrument types from API to display categories
const TYPE_CATEGORY_MAP: Record<string, { name: string; color: string }> = {
  'Common Stock': { name: 'Stocks', color: '#8b5cf6' }, // purple
  'American Depositary Receipt': { name: 'Stocks', color: '#8b5cf6' }, // ADRs like TSM
  'ETF': { name: 'Funds', color: '#3b82f6' }, // blue
  'Mutual Fund': { name: 'Funds', color: '#3b82f6' }, // blue
  'Bond ETF': { name: 'Funds', color: '#3b82f6' }, // blue (backwards compat)
  'Bond Mutual Fund': { name: 'Funds', color: '#3b82f6' }, // blue (backwards compat)
  'Money Market': { name: 'Cash / Money Market', color: '#22c55e' }, // green
  'Cash': { name: 'Cash / Money Market', color: '#22c55e' }, // green
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
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const totalValue = consolidatedHoldings.reduce((sum, h) => sum + h.value, 0);

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

  for (const holding of consolidatedHoldings) {
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
  const maxNameLength = Math.max(...typeData.map((t) => t.name.length));

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-text-primary">By Asset Class</h2>
      </div>

      <div className="p-3 space-y-0.5">
        {typeData.map((type) => {
          const barWidth = maxAllocation > 0 ? (type.allocation / maxAllocation) * 100 : 0;
          const isExpanded = expandedCategories.has(type.name);

          return (
            <div key={type.name}>
              <button
                onClick={() => toggleCategory(type.name)}
                className="w-full flex items-center gap-1.5 px-1 hover:bg-background/50 rounded transition-colors"
              >
                <span
                  className="font-medium text-text-primary text-sm shrink-0 whitespace-nowrap"
                  style={{ minWidth: `${maxNameLength}ch` }}
                >
                  {type.name}
                </span>
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <div
                    className="h-5 rounded transition-all duration-500 flex items-center justify-end px-1.5"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: type.color,
                    }}
                  >
                    {barWidth >= 12 && (
                      <span className="text-xs font-medium text-white/90">
                        {type.allocation.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {barWidth < 12 && (
                    <span className="text-xs font-medium text-text-secondary">
                      {type.allocation.toFixed(1)}%
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-text-secondary shrink-0 transition-transform duration-200 ${
                    isExpanded ? 'rotate-0' : '-rotate-90'
                  }`}
                />
              </button>
              {isExpanded && (
                <div className="ml-1">
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
