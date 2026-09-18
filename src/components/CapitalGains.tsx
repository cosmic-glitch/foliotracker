import { useMemo, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { ArrowUpDown, ChartLine, ChevronDown, ChevronUp } from 'lucide-react';
import { formatChange, formatCurrency, formatPercent, formatPrice } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { TickerDetailModal } from './TickerDetailModal';
import { useTickerDetailParam } from '../hooks/useTickerDetailParam';

// The "CG" tab: unrealized capital gains per holding. Only holdings with a
// cost basis take part — the totals here are therefore a partial view of the
// portfolio, which the footer makes explicit by counting what's left out.
// One table serves desktop and mobile; the cost/value columns drop out on
// phones and the diverging bar (a shared zero baseline, gains to the right,
// losses to the left) keeps the relative picture readable on either.

type SortColumn = 'ticker' | 'costBasis' | 'value' | 'profitLoss' | 'profitLossPercent';
type SortDirection = 'asc' | 'desc';

function getSortValue(holding: Holding, column: SortColumn): string | number | null {
  switch (column) {
    case 'ticker':
      return holding.ticker;
    case 'costBasis':
      return holding.costBasis;
    case 'value':
      return holding.value;
    case 'profitLoss':
      return holding.profitLoss;
    case 'profitLossPercent':
      return holding.profitLossPercent;
  }
}

const COLUMNS: Array<{ column: SortColumn; label: string; title?: string; className?: string }> = [
  { column: 'ticker', label: 'Asset' },
  { column: 'costBasis', label: 'Cost', title: 'Total cost basis', className: 'hidden md:table-cell' },
  { column: 'value', label: 'Value', title: 'Current market value', className: 'hidden md:table-cell' },
  { column: 'profitLoss', label: 'Gain', title: 'Unrealized gain or loss (value − cost)' },
  { column: 'profitLossPercent', label: '%', title: 'Gain as a percentage of cost basis' },
];

interface CapitalGainsProps {
  holdings: Holding[];
}

export function CapitalGains({ holdings }: CapitalGainsProps) {
  const [sortConfig, setSortConfig] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'profitLoss',
    direction: 'desc',
  });

  const consolidated = useMemo(() => consolidateHoldings(holdings), [holdings]);

  const { rows, excluded, excludedAllocation, maxAbsGain } = useMemo(() => {
    const withBasis = consolidated.filter((h) => h.profitLoss !== null);
    const without = consolidated.filter((h) => h.profitLoss === null);
    const sorted = [...withBasis].sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.column);
      const bValue = getSortValue(b, sortConfig.column);
      // Nulls (a 0-cost row's percent) stay at the bottom in both directions.
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const result = aValue.localeCompare(bValue);
        return sortConfig.direction === 'asc' ? result : -result;
      }
      const result = Number(aValue) - Number(bValue);
      return sortConfig.direction === 'asc' ? result : -result;
    });
    return {
      rows: sorted,
      excluded: without.length,
      excludedAllocation: without.reduce((sum, h) => sum + h.allocation, 0),
      maxAbsGain: withBasis.reduce((max, h) => Math.max(max, Math.abs(h.profitLoss ?? 0)), 0),
    };
  }, [consolidated, sortConfig]);

  // Open detail panel is URL state (`?t=TICKER`); only one tab renders at a
  // time, so this doesn't double up with HoldingsTable's instance.
  const { openTicker, openDetail, closeDetail } = useTickerDetailParam();
  const detailHolding = openTicker
    ? rows.find((h) => h.ticker === openTicker && !h.isStatic) ?? null
    : null;

  const handleSort = (column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: column === 'ticker' ? 'asc' : 'desc' };
    });
  };

  const renderSortIcon = (column: SortColumn) => {
    if (sortConfig.column !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-text-secondary/70 group-hover:text-text-secondary" />;
    }
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-accent" />
      : <ChevronDown className="w-3.5 h-3.5 text-accent" />;
  };

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border px-4 py-6">
        <p className="text-text-secondary text-sm">
          No holdings in this portfolio have a cost basis yet. Add one in the editor to see unrealized gains.
        </p>
      </div>
    );
  }

  const totalCost = rows.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalValue = rows.reduce((sum, h) => sum + h.value, 0);
  const totalGain = rows.reduce((sum, h) => sum + (h.profitLoss ?? 0), 0);
  const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : null;
  const winners = rows.filter((h) => (h.profitLoss ?? 0) > 0).length;
  const losers = rows.filter((h) => (h.profitLoss ?? 0) < 0).length;
  const totalColor = totalGain >= 0 ? 'text-positive' : 'text-negative';
  const totalBg = totalGain >= 0 ? 'bg-positive/10' : 'bg-negative/10';

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Headline: the gain leads, cost and value give it scale. */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className={`col-span-3 md:col-span-1 rounded-2xl border border-border px-4 py-3 md:py-4 ${totalBg}`}>
          <p className="text-xs md:text-sm text-text-secondary">Unrealized gain</p>
          <p className={`text-2xl md:text-3xl font-semibold tabular-nums ${totalColor}`}>
            {formatChange(totalGain, true)}
          </p>
          <p className={`text-sm tabular-nums ${totalColor}`}>
            {totalGainPercent !== null ? formatPercent(totalGainPercent) : '—'}
            <span className="text-text-secondary">
              {' · '}{winners} up, {losers} down
            </span>
          </p>
        </div>
        <div className="col-span-3 grid grid-cols-2 gap-2 md:gap-4 md:col-span-2">
          <div className="bg-card rounded-2xl border border-border px-4 py-3 md:py-4">
            <p className="text-xs md:text-sm text-text-secondary">Cost basis</p>
            <p className="text-xl md:text-3xl font-semibold text-text-primary tabular-nums">
              {formatCurrency(totalCost, true)}
            </p>
          </div>
          <div className="bg-card rounded-2xl border border-border px-4 py-3 md:py-4">
            <p className="text-xs md:text-sm text-text-secondary">Market value</p>
            <p className="text-xl md:text-3xl font-semibold text-text-primary tabular-nums">
              {formatCurrency(totalValue, true)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map(({ column, label, title, className }, i) => (
                <th
                  key={column}
                  // w-px pins each text column to its content so the bar
                  // column absorbs every leftover pixel (matters on phones).
                  className={`w-px text-text-secondary text-sm font-medium px-2 md:px-4 py-2 whitespace-nowrap ${
                    i === 0 ? 'text-left' : 'text-right'
                  } ${className ?? ''}`}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(column)}
                    title={title}
                    className="group inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
                  >
                    <span>{label}</span>
                    {renderSortIcon(column)}
                  </button>
                </th>
              ))}
              {/* Diverging bar column: no header text, it's the row's own
                  gain made visual. Takes whatever width the numbers leave. */}
              <th className="px-2 md:px-4 py-2" aria-label="Gain relative to the largest position gain or loss" />
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const gain = h.profitLoss ?? 0;
              const isPositive = gain >= 0;
              const color = isPositive ? 'text-positive' : 'text-negative';
              const barColor = isPositive ? 'bg-positive' : 'bg-negative';
              const barWidth = maxAbsGain > 0 ? (Math.abs(gain) / maxAbsGain) * 50 : 0;
              const avgCost = !h.isStatic && h.shares > 0 && h.costBasis !== null ? h.costBasis / h.shares : null;
              return (
                <tr key={h.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-2 md:px-4 py-2 whitespace-nowrap align-middle">
                    {h.isStatic ? (
                      <span title={h.ticker} className="font-semibold text-text-primary block truncate max-w-[10ch]">{h.ticker}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openDetail(h.ticker)}
                        className="group/ticker inline-flex min-w-0 items-center gap-1 font-semibold text-accent hover:underline underline-offset-2 decoration-accent/50"
                        title={`${h.ticker} price history & details`}
                      >
                        <span className="truncate">{h.ticker}</span>
                        <ChartLine className="w-3 h-3 shrink-0 opacity-60 group-hover/ticker:opacity-100" />
                      </button>
                    )}
                    {/* Avg cost → price: the per-share story behind the dollar
                        gain, desktop only so the phone row stays one line. */}
                    {avgCost !== null && (
                      <p className="hidden md:block text-xs text-text-secondary tabular-nums" title="Average cost per share → current price">
                        {formatPrice(avgCost)} → {formatPrice(h.currentPrice)}
                      </p>
                    )}
                  </td>
                  <td className="hidden md:table-cell text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm text-text-primary tabular-nums align-middle">
                    {formatCurrency(h.costBasis ?? 0, true)}
                  </td>
                  <td className="hidden md:table-cell text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm text-text-primary tabular-nums align-middle">
                    {formatCurrency(h.value, true)}
                  </td>
                  <td className={`text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm font-medium tabular-nums align-middle ${color}`}>
                    {formatChange(gain, true)}
                  </td>
                  <td className={`text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm tabular-nums align-middle ${color}`}>
                    {h.profitLossPercent !== null ? formatPercent(h.profitLossPercent) : ''}
                  </td>
                  <td className="px-2 md:px-4 py-2 align-middle">
                    <div
                      className="relative h-2.5 min-w-[64px]"
                      title={`${h.ticker}: ${formatChange(gain)}${h.profitLossPercent !== null ? ` (${formatPercent(h.profitLossPercent)})` : ''}`}
                    >
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      {barWidth > 0 && (
                        <div
                          className={`absolute inset-y-0 ${barColor} ${isPositive ? 'left-1/2 rounded-r' : 'right-1/2 rounded-l'}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-border bg-card-hover">
              <td className="px-2 md:px-4 py-2 font-bold text-text-primary whitespace-nowrap">Total</td>
              <td className="hidden md:table-cell text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm font-bold text-text-primary tabular-nums">
                {formatCurrency(totalCost, true)}
              </td>
              <td className="hidden md:table-cell text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm font-bold text-text-primary tabular-nums">
                {formatCurrency(totalValue, true)}
              </td>
              <td className={`text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm font-bold tabular-nums ${totalColor}`}>
                {formatChange(totalGain, true)}
              </td>
              <td className={`text-right px-2 md:px-4 py-2 whitespace-nowrap text-sm font-bold tabular-nums ${totalColor}`}>
                {totalGainPercent !== null ? formatPercent(totalGainPercent) : ''}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="border-t border-border px-2 md:px-4 py-3 space-y-1.5 text-xs text-text-secondary">
          <p>
            Unrealized only — these are paper gains against the cost basis you entered, before any
            taxes or fees. The bar shows each gain relative to the largest one.
          </p>
          {excluded > 0 && (
            <p>
              {excluded === 1 ? '1 holding' : `${excluded} holdings`} without a cost basis
              ({excludedAllocation.toFixed(0)}% of the portfolio) {excluded === 1 ? 'is' : 'are'} not
              included in these figures.
            </p>
          )}
        </div>
      </div>

      {detailHolding && (
        <TickerDetailModal subject={detailHolding} onClose={closeDetail} />
      )}
    </div>
  );
}
