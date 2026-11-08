import { useMemo, useState } from 'react';
import type { Holding } from '../types/portfolio';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { formatFiscalYearEnd, formatPERatio } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

// The "PE" tab: every market-priced holding's valuation multiples side by
// side. Same four figures companiesmarketcap.org publishes — trailing PE,
// forward PE (ongoing FY), forward PE next FY, forward PE FY+2 — and, like
// its table, each forward PE carries a small "FY Jan '27" line naming the
// month that fiscal year ends (companies' years end in different months). One table
// serves both desktop and mobile. Mobile is the primary surface: columns
// stay narrow (px-1.5, inactive sort icons and the labels' "FY " hidden below
// sm) so all five fit a 390px phone, and the table wrapper scrolls
// horizontally as a backstop so a column can never be clipped.

type SortColumn = 'ticker' | 'peRatio' | 'forwardPE' | 'forwardPENext' | 'forwardPENext2';
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
    case 'forwardPENext2':
      return holding.forwardPENext2;
  }
}

const FY_LABEL_HINT = ' The small label under each value is the month that fiscal year ends.';

// Labels are deliberately unspaced ("FwdPE+1") to keep columns narrow on phones.
const COLUMNS: Array<{ column: SortColumn; label: string; title?: string }> = [
  { column: 'ticker', label: 'Asset' },
  {
    column: 'peRatio',
    label: 'TTM PE',
    title: 'Trailing PE on the last four reported quarters',
  },
  {
    column: 'forwardPE',
    label: 'FwdPE',
    title: "FwdPE on the ongoing fiscal year's EPS estimate (blends reported quarters with projections)." + FY_LABEL_HINT,
  },
  {
    column: 'forwardPENext',
    label: 'FwdPE+1',
    title: "FwdPE on next fiscal year's EPS estimate (pure projection — no reported quarters mixed in)." + FY_LABEL_HINT,
  },
  {
    column: 'forwardPENext2',
    label: 'FwdPE+2',
    title: "FwdPE on the fiscal year after next's EPS estimate (pure projection — thinner analyst coverage than FwdPE+1)." + FY_LABEL_HINT,
  },
];

// Forward PE with the fiscal year its estimate covers as a small muted second
// line ("FY Jan '27"; just "Jan '27" on phones, where the "FY" would widen
// the column past the header). Empty cell when there's no value.
function ForwardPEValue({ value, fiscalYearEnd }: { value: number | null; fiscalYearEnd: string | null }) {
  if (value == null) return null;
  const label = formatFiscalYearEnd(fiscalYearEnd);
  return (
    <>
      {formatPERatio(value)}
      {label && (
        <span className="block text-xs leading-4 text-text-secondary">
          <span className="hidden sm:inline">FY </span>
          {label}
        </span>
      )}
    </>
  );
}

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
      (h) => !h.isStatic && (h.peRatio != null || h.forwardPE != null || h.forwardPENext != null || h.forwardPENext2 != null),
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
    const isActive = sortConfig.column === column;
    // Inactive columns hide their icon on phones to save width; the header
    // is still a sort button, and the active column always shows its chevron.
    const visibility = isActive ? 'inline-flex' : 'hidden sm:inline-flex';
    const icon = !isActive ? (
      <ArrowUpDown className="w-3.5 h-3.5 text-text-secondary/70 group-hover:text-text-secondary" />
    ) : sortConfig.direction === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5 text-accent" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-accent" />
    );
    return <span className={visibility}>{icon}</span>;
  };

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border px-4 py-6">
        <p className="text-text-secondary text-sm">
          No PE data is available for this portfolio's holdings.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map(({ column, label, title }) => (
              <th key={column} className="text-left text-text-secondary text-sm font-medium px-1.5 md:px-4 py-2 whitespace-nowrap">
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
              <td className="px-1.5 md:px-4 py-2 whitespace-nowrap">
                <span className="font-semibold text-text-primary">{holding.ticker}</span>
              </td>
              <td className="px-1.5 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                {holding.peRatio != null ? formatPERatio(holding.peRatio) : ''}
              </td>
              <td className="px-1.5 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                <ForwardPEValue value={holding.forwardPE} fiscalYearEnd={holding.forwardEPSDate} />
              </td>
              <td className="px-1.5 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                <ForwardPEValue value={holding.forwardPENext} fiscalYearEnd={holding.forwardEPSNextDate} />
              </td>
              <td className="px-1.5 md:px-4 py-2 text-sm text-text-primary whitespace-nowrap">
                <ForwardPEValue value={holding.forwardPENext2} fiscalYearEnd={holding.forwardEPSNext2Date} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="border-t border-border px-3 md:px-4 py-3 space-y-1.5 text-xs text-text-secondary">
        <p>
          <span className="font-medium text-text-primary">TTM PE</span> — based on EPS of the last
          four reported quarters; can include one-time items (investment gains, write-offs) that
          distort the multiple.
        </p>
        <p>
          <span className="font-medium text-text-primary">FwdPE</span> — based on estimated EPS
          of the current fiscal year; since part of the year is already reported, one-time
          items from those quarters can still distort it.
        </p>
        <p>
          <span className="font-medium text-text-primary">FwdPE+1</span> — based on estimated
          EPS of the next fiscal year; no reported quarters, so no one-time items, but estimates
          that far out carry less certainty. The table sorts by this.
        </p>
        <p>
          <span className="font-medium text-text-primary">FwdPE+2</span> — based on estimated
          EPS of the fiscal year after next; same purity as FwdPE+1, but thinner analyst
          coverage makes it the least certain of the four.
        </p>
        <p>
          The label under each forward PE is the month that company's fiscal year ends.
          Companies' fiscal years end in different months: NVDA's in January, AAPL's in September.
        </p>
      </div>
    </div>
  );
}
