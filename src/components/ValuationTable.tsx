import { useMemo, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { formatPERatio } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

// The "P/E" tab: every market-priced holding's valuation multiples side by
// side. Same three figures companiesmarketcap.org publishes — trailing P/E,
// forward P/E (ongoing FY), forward P/E next FY. One table serves both
// desktop and mobile; four narrow columns fit a phone without a separate
// layout, unlike HoldingsTable's wide fundamentals sprawl.

type SortColumn = 'ticker' | 'peRatio' | 'forwardPE' | 'forwardPENext';
type SortDirection = 'asc' | 'desc';

function getSortValue(holding: Holding, column: SortColumn): string | number | null {
  switch (column) {
    case 'ticker':
      return holding.ticker;
    case 'peRatio':
      return holding.peRatio;
    case 'forwardPE':
      return holding.forwardPE;
    case 'forwardPENext':
      return holding.forwardPENext;
  }
}

const COLUMNS: Array<{ column: SortColumn; label: string; title?: string }> = [
  { column: 'ticker', label: 'Asset' },
  {
    column: 'peRatio',
    label: 'P/E',
    title: 'Trailing P/E on the last four reported quarters',
  },
  {
    column: 'forwardPE',
    label: 'Fwd P/E',
    title: "Forward P/E on the ongoing fiscal year's EPS estimate (blends reported quarters with projections)",
  },
  {
    column: 'forwardPENext',
    label: 'Fwd P/E +1',
    title: "Forward P/E on next fiscal year's EPS estimate (pure projection — no reported quarters mixed in)",
  },
];

interface ValuationTableProps {
  holdings: Holding[];
}

export function ValuationTable({ holdings }: ValuationTableProps) {
  const [sortConfig, setSortConfig] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'forwardPENext',
    direction: 'asc',
  });

  // Only rows with at least one multiple — funds, static assets, and
  // loss-making companies without a forward estimate have nothing to show.
  const rows = useMemo(() => {
    const withData = consolidateHoldings(holdings).filter(
      (h) => !h.isStatic && (h.peRatio != null || h.forwardPE != null || h.forwardPENext != null),
    );
    const sorted = [...withData];
    sorted.sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.column);
      const bValue = getSortValue(b, sortConfig.column);

      // Null values stay at the bottom in both directions.
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
    return sorted;
  }, [holdings, sortConfig]);

  const handleSort = (column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      // Cheapest-first is the point of the tab, so every column defaults asc.
      return { column, direction: 'asc' };
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
          No P/E data is available for this portfolio's holdings.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map(({ column, label, title }) => (
              <th key={column} className="text-left text-text-secondary text-sm font-medium px-3 md:px-4 py-2 whitespace-nowrap">
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
          </tr>
        </thead>
        <tbody>
          {rows.map((holding) => (
            <tr key={holding.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
              <td className="px-3 md:px-4 py-2 whitespace-nowrap">
                <span className="font-semibold text-text-primary">{holding.ticker}</span>
              </td>
              <td className="px-3 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                {holding.peRatio != null ? formatPERatio(holding.peRatio) : ''}
              </td>
              <td className="px-3 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                {holding.forwardPE != null ? formatPERatio(holding.forwardPE) : ''}
              </td>
              <td className="px-3 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                {holding.forwardPENext != null ? formatPERatio(holding.forwardPENext) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
