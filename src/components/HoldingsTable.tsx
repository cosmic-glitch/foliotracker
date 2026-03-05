import { useState, useMemo } from 'react';
import type { Holding } from '../types/portfolio';
import { ArrowUpDown, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent, formatPrice, formatLargeValue, formatPERatio, formatPctTo52WeekHigh, formatMarginOrGrowth } from '../utils/formatters';
import { consolidateHoldings } from '../utils/equivalentTickers';

interface HoldingsTableProps {
  holdings: Holding[];
}

type SortColumn =
  | 'ticker'
  | 'currentPrice'
  | 'value'
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

function getSortValue(holding: Holding, column: SortColumn): string | number | null {
  switch (column) {
    case 'ticker':
      return holding.ticker;
    case 'currentPrice':
      return holding.isStatic ? null : holding.currentPrice;
    case 'value':
      return holding.value;
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
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  const maxTickerLength = useMemo(() => Math.max(...consolidatedHoldings.filter((h) => !h.isStatic).map((h) => h.ticker.length)), [consolidatedHoldings]);
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

  const sortedDesktopHoldings = useMemo(() => {
    const sorted = [...consolidatedHoldings];
    sorted.sort((a, b) => {
      const aValue = getSortValue(a, sortConfig.column);
      const bValue = getSortValue(b, sortConfig.column);

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
  }, [consolidatedHoldings, sortConfig]);

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
    'group inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors';

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('ticker')} className={getHeaderButtonClass()}>
                  <span>Asset</span>
                  {renderSortIcon('ticker')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('currentPrice')} className={getHeaderButtonClass()}>
                  <span>Unit Price</span>
                  {renderSortIcon('currentPrice')}
                </button>
              </th>
              <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                <button type="button" onClick={() => handleSort('value')} className={getHeaderButtonClass()}>
                  <span>Holding Size</span>
                  {renderSortIcon('value')}
                </button>
              </th>
              {hasAnyFundamentals && (
                <>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('revenue')} className={getHeaderButtonClass()}>
                      <span>Rev.</span>
                      {renderSortIcon('revenue')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('earnings')} className={getHeaderButtonClass()}>
                      <span>Earn.</span>
                      {renderSortIcon('earnings')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('forwardPE')} className={getHeaderButtonClass()}>
                      <span>Fwd P/E</span>
                      {renderSortIcon('forwardPE')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('operatingMargin')} className={getHeaderButtonClass()}>
                      <span>Op. Mar.</span>
                      {renderSortIcon('operatingMargin')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('revenueGrowth3Y')} className={getHeaderButtonClass()}>
                      <span>Rev. Gr. 3Y</span>
                      {renderSortIcon('revenueGrowth3Y')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('epsGrowth3Y')} className={getHeaderButtonClass()}>
                      <span>EPS Gr. 3Y</span>
                      {renderSortIcon('epsGrowth3Y')}
                    </button>
                  </th>
                  <th className="text-left text-text-secondary text-sm font-medium px-4 py-2">
                    <button type="button" onClick={() => handleSort('pctTo52WeekHigh')} className={getHeaderButtonClass()}>
                      <span>% to 52w Hi</span>
                      {renderSortIcon('pctTo52WeekHigh')}
                    </button>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedDesktopHoldings.map((holding) => (
                <tr key={holding.ticker} className="border-b border-border last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-text-primary">{holding.ticker}</p>
                    </div>
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    {!holding.isStatic ? (
                      <>
                        <span className="font-medium text-text-primary">{formatPrice(holding.currentPrice)}</span>
                        {holding.dayChangePercent !== 0 && (
                          <span className={`text-sm ml-1 ${holding.dayChangePercent >= 0 ? 'text-positive' : 'text-negative'}`}>({formatPercent(holding.dayChangePercent)})</span>
                        )}
                      </>
                    ) : (
                      <span />
                    )}
                  </td>
                  <td className="text-left px-4 py-2 whitespace-nowrap">
                    <span className="font-semibold text-text-primary">
                      {formatCurrency(holding.value, true)}
                    </span>
                    {!holding.isStatic && holding.dayChange !== 0 && (
                      <span className={`text-sm ml-1 ${holding.dayChange >= 0 ? 'text-positive' : 'text-negative'}`}>
                        ({formatChange(holding.dayChange, true)})
                      </span>
                    )}
                  </td>
                  {hasAnyFundamentals && (
                    <>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.revenue != null ? formatLargeValue(holding.revenue) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.earnings != null ? formatLargeValue(holding.earnings) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.forwardPE != null ? formatPERatio(holding.forwardPE) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.operatingMargin != null ? formatMarginOrGrowth(holding.operatingMargin) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.revenueGrowth3Y != null ? formatMarginOrGrowth(holding.revenueGrowth3Y) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.epsGrowth3Y != null ? formatMarginOrGrowth(holding.epsGrowth3Y) : ''}</td>
                      <td className="text-left px-4 py-2 text-sm text-text-primary">{holding.pctTo52WeekHigh != null ? formatPctTo52WeekHigh(holding.pctTo52WeekHigh) : ''}</td>
                    </>
                  )}
                </tr>
            ))}
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
