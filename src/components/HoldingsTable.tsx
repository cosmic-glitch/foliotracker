import { useState, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { ArrowUpDown, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent, formatPrice, formatLargeValue, formatPERatio, formatPctTo52WeekHigh, formatMarginOrGrowth } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { useTimeframe } from '../context/TimeframeContext';

// Resolve which change pair drives the "Chg %" / "Chg $" columns for the
// active global timeframe. Returns null when the snapshot lacks 30D data
// (older snapshots written before pass 2, or new tickers without history).
// Static holdings get 0/0 from the snapshot — fine to render as empty since
// the existing `!== 0` gate already collapses them.
function activeChange(
  holding: Holding,
  timeframe: 'day' | '30d',
): { change: number | null; percent: number | null } {
  if (timeframe === '30d') {
    return {
      change: holding.thirtyDayChange,
      percent: holding.thirtyDayChangePercent,
    };
  }
  return { change: holding.dayChange, percent: holding.dayChangePercent };
}

interface HoldingsTableProps {
  holdings: Holding[];
}

type SortColumn =
  | 'ticker'
  | 'currentPrice'
  | 'dayChangePercent'
  | 'value'
  | 'dayChange'
  | 'revenue'
  | 'earnings'
  | 'forwardPE'
  | 'operatingMargin'
  | 'revenueGrowth3Y'
  | 'epsGrowth3Y'
  | 'pctTo52WeekHigh';

type SortDirection = 'asc' | 'desc';

function getDefaultSortDirection(column: SortColumn): SortDirection {
  return column === 'ticker' ? 'asc' : 'desc';
}

// `dayChange` / `dayChangePercent` column keys are kept (no UI churn on the
// sort enum) but read whichever timeframe's pair is active. Static holdings
// always return null so they sort to the bottom regardless of timeframe.
function getSortValue(
  holding: Holding,
  column: SortColumn,
  timeframe: 'day' | '30d',
): string | number | null {
  switch (column) {
    case 'ticker':
      return holding.ticker;
    case 'currentPrice':
      return holding.isStatic ? null : holding.currentPrice;
    case 'dayChangePercent':
      return holding.isStatic ? null : activeChange(holding, timeframe).percent;
    case 'value':
      return holding.value;
    case 'dayChange':
      return holding.isStatic ? null : activeChange(holding, timeframe).change;
    case 'revenue':
      return holding.revenue;
    case 'earnings':
      return holding.earnings;
    case 'forwardPE':
      return holding.forwardPE;
    case 'operatingMargin':
      return holding.operatingMargin;
    case 'revenueGrowth3Y':
      return holding.revenueGrowth3Y;
    case 'epsGrowth3Y':
      return holding.epsGrowth3Y;
    case 'pctTo52WeekHigh':
      return holding.pctTo52WeekHigh;
    default:
      return null;
  }
}

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const { timeframe } = useTimeframe();
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const [popover, setPopover] = useState<{ ticker: string; top: number; left: number } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'value',
    direction: 'desc',
  });
  const popoverHolding = popover ? consolidatedHoldings.find(h => h.ticker === popover.ticker) : null;

  const openPopover = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ ticker, top: rect.bottom + 4, left: rect.left });
  };

  const handleSort = (column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { column, direction: getDefaultSortDirection(column) };
    });
  };

  const sortedHoldings = useMemo(() => {
    const sorted = [...consolidatedHoldings];
    sorted.sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.column, timeframe);
      const bValue = getSortValue(b, sortConfig.column, timeframe);

      // Keep null/empty fundamental values at the bottom in both directions.
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
  }, [consolidatedHoldings, sortConfig, timeframe]);

  const hasAnyFundamentals = consolidatedHoldings.some(
    (h) => h.revenue != null || h.earnings != null || h.forwardPE != null || h.pctTo52WeekHigh != null || h.operatingMargin != null || h.revenueGrowth3Y != null || h.epsGrowth3Y != null
  );

  const renderSortIcon = (column: SortColumn) => {
    if (sortConfig.column !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-text-secondary/70 group-hover:text-text-secondary" />;
    }
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-accent" />
      : <ChevronDown className="w-3.5 h-3.5 text-accent" />;
  };

  const getHeaderButtonClass = () =>
    'group inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap';

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="w-[11ch] min-w-[11ch] max-w-[11ch] text-left text-text-secondary text-sm font-medium px-4 py-2 whitespace-nowrap">
                <button type="button" onClick={() => handleSort('ticker')} className={getHeaderButtonClass()}>
                  <span>Asset</span>
                  {renderSortIcon('ticker')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('currentPrice')} className={getHeaderButtonClass()}>
                  <span>Price</span>
                  {renderSortIcon('currentPrice')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('dayChangePercent')} className={getHeaderButtonClass()}>
                  <span>Chg %</span>
                  {renderSortIcon('dayChangePercent')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('value')} className={getHeaderButtonClass()}>
                  <span>Size</span>
                  {renderSortIcon('value')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('dayChange')} className={getHeaderButtonClass()}>
                  <span>Chg $</span>
                  {renderSortIcon('dayChange')}
                </button>
              </th>
              {hasAnyFundamentals && (
                <>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('pctTo52WeekHigh')} className={getHeaderButtonClass()}>
                      <span>%To52wkHi</span>
                      {renderSortIcon('pctTo52WeekHigh')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('revenue')} className={getHeaderButtonClass()}>
                      <span>Rev</span>
                      {renderSortIcon('revenue')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('earnings')} className={getHeaderButtonClass()}>
                      <span>Profit</span>
                      {renderSortIcon('earnings')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('forwardPE')} className={getHeaderButtonClass()}>
                      <span>FwdPE</span>
                      {renderSortIcon('forwardPE')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('operatingMargin')} className={getHeaderButtonClass()}>
                      <span>OpMgn</span>
                      {renderSortIcon('operatingMargin')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('revenueGrowth3Y')} className={getHeaderButtonClass()}>
                      <span>3YRevGr</span>
                      {renderSortIcon('revenueGrowth3Y')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('epsGrowth3Y')} className={getHeaderButtonClass()}>
                      <span>3YEPSGr</span>
                      {renderSortIcon('epsGrowth3Y')}
                    </button>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((holding) => {
              // Active change pair flips with the global timeframe.
              // `change`/`percent` can be null when the snapshot lacks 30D
              // data for this ticker — render empty (same fallback as 1D
              // when the value is 0).
              const { change, percent } = activeChange(holding, timeframe);
              return (
                <tr key={holding.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                  <td className="w-[11ch] min-w-[11ch] max-w-[11ch] px-4 py-2 whitespace-nowrap">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-semibold text-text-primary">{holding.ticker}</p>
                    </div>
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    {!holding.isStatic ? (
                      <span className="font-medium text-text-primary">{formatPrice(holding.currentPrice)}</span>
                    ) : (
                      <span />
                    )}
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    {!holding.isStatic && percent !== null && percent !== 0 && (
                      <span className={`text-sm ${percent >= 0 ? 'text-positive' : 'text-negative'}`}>{formatPercent(percent)}</span>
                    )}
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    <span className="font-semibold text-text-primary">
                      {formatCurrency(holding.value, true)}
                    </span>
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    {!holding.isStatic && change !== null && change !== 0 && (
                      <span className={`text-sm ${change >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {formatChange(change, true)}
                      </span>
                    )}
                  </td>
                  {hasAnyFundamentals && (
                    <>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.pctTo52WeekHigh != null ? formatPctTo52WeekHigh(holding.pctTo52WeekHigh) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.revenue != null ? formatLargeValue(holding.revenue) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.earnings != null ? formatLargeValue(holding.earnings) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.forwardPE != null ? formatPERatio(holding.forwardPE) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.operatingMargin != null ? formatMarginOrGrowth(holding.operatingMargin) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.revenueGrowth3Y != null ? formatMarginOrGrowth(holding.revenueGrowth3Y) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.epsGrowth3Y != null ? formatMarginOrGrowth(holding.epsGrowth3Y) : ''}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Table — an auto-sizing <table> (not a fixed grid) so each
          column is exactly as wide as its content: the ticker and price
          columns shrink to fit, and the value column carries `w-full` to
          absorb the remaining width. This packs the row optimally (no wasted
          50/50 slack) so the value + $-change never gets clipped by the
          card's overflow-hidden, while the table's uniform column widths keep
          every value left-aligned in one column. Static holdings have no price
          — their name spans the ticker+price columns via colSpan, with the
          value still landing in the aligned final column. */}
      <table className="md:hidden w-full">
        <tbody>
          {sortedHoldings.map((holding) => {
            const holdingHasFundamentals = !holding.isStatic && hasAnyFundamentals && (holding.revenue != null || holding.earnings != null || holding.forwardPE != null || holding.pctTo52WeekHigh != null || holding.operatingMargin != null || holding.revenueGrowth3Y != null || holding.epsGrowth3Y != null);
            const sortArrow = sortConfig.direction === 'desc' ? ' ↓' : ' ↑';
            const { change, percent } = activeChange(holding, timeframe);
            return (
              <tr key={holding.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                {/* Ticker/name + info — static names span the price column too */}
                <td colSpan={holding.isStatic ? 2 : 1} className="pl-3 pr-2 py-2 whitespace-nowrap align-middle">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-text-primary block truncate max-w-[55vw]">{holding.ticker}</span>
                    {holdingHasFundamentals && (
                      <button onClick={(e) => openPopover(holding.ticker, e)} className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
                {/* Unit price + % change (tradeable only) */}
                {!holding.isStatic && (
                  <td className="pr-2 py-2 whitespace-nowrap text-left align-middle">
                    <span
                      onClick={() => handleSort('currentPrice')}
                      className="text-text-primary text-sm cursor-pointer select-none"
                    >
                      {formatPrice(holding.currentPrice)}
                      {sortConfig.column === 'currentPrice' && (
                        <span className="text-accent text-xs">{sortArrow}</span>
                      )}
                    </span>
                    {percent !== null && percent !== 0 && (
                      <span
                        onClick={() => handleSort('dayChangePercent')}
                        className={`text-xs ml-1 cursor-pointer select-none ${percent >= 0 ? 'text-positive' : 'text-negative'}`}
                      >
                        {formatPercent(percent)}
                        {sortConfig.column === 'dayChangePercent' && (
                          <span className="text-accent">{sortArrow}</span>
                        )}
                      </span>
                    )}
                  </td>
                )}
                {/* Value + $ change — w-full absorbs the leftover width */}
                <td className="w-full pr-3 py-2 whitespace-nowrap text-left align-middle">
                  <span
                    onClick={() => handleSort('value')}
                    className="font-semibold text-text-primary cursor-pointer select-none"
                  >
                    {formatCurrency(holding.value, true)}
                    {sortConfig.column === 'value' && (
                      <span className="text-accent text-xs">{sortArrow}</span>
                    )}
                  </span>
                  {!holding.isStatic && change !== null && change !== 0 && (
                    <span
                      onClick={() => handleSort('dayChange')}
                      className={`text-xs ml-1 cursor-pointer select-none ${change >= 0 ? 'text-positive' : 'text-negative'}`}
                    >
                      {formatChange(change, true)}
                      {sortConfig.column === 'dayChange' && (
                        <span className="text-accent">{sortArrow}</span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
                  <span className="text-text-secondary">Op Margin</span>
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
