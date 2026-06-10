import { Fragment } from 'react';
import { Flame } from 'lucide-react';

export interface MarketMover {
  ticker: string;
  changePercent: number;
  numPortfolios: number;
}

interface MoversStripProps {
  movers: MarketMover[];
}

// Rounded pill directly above the Users card (same width as the card).
// Shows the most-held names swinging the most today (criteria computed
// server-side in api/portfolios.ts). Renders nothing on quiet days — an empty
// strip beats training users that it's filler.
//
// Two layouts behind one breakpoint:
//   • Mobile (default): a CSS grid of two entry-columns, each split into three
//     tracks (ticker | % | held-by). Entries flow row-major into those tracks,
//     so within each column the tickers, percentages, and "held by" counts line
//     up independently — easier to scan than ragged flex-wrap. Capped at 4
//     entries (2 columns × 2 rows) so the pill never exceeds two lines. Movers
//     arrive pre-sorted by significance (breadth × |move|), so slicing keeps the
//     most important ones.
//   • Desktop (md+): a flex-wrap of self-contained blobs, capped at 6. At every
//     width ≥ md roughly 3–4 entries fit per row, so 6 keeps the pill to at most
//     two rows while showing everything on a normal day. The list is ranked, so
//     a truncated tail drops the least significant names.
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  const mobileMovers = movers.slice(0, 4);
  const desktopMovers = movers.slice(0, 6);

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2 flex items-center gap-2 md:gap-4"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Flame lives outside the layout containers so wrapped rows start at the
          same x as the first row's text instead of under the icon. */}
      <Flame className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />

      {/* Mobile: aligned two-column grid (ticker | % | held-by per column). */}
      <div className="md:hidden grid grid-cols-[auto_auto_auto_auto_auto_auto] items-baseline gap-x-1.5 gap-y-1">
        {mobileMovers.map((mover, i) => {
          const isPositive = mover.changePercent >= 0;
          const secondColumn = i % 2 === 1;
          return (
            <Fragment key={mover.ticker}>
              <span
                className={`font-medium text-text-primary text-sm whitespace-nowrap ${secondColumn ? 'pl-4' : ''}`}
                title={`Held in ${mover.numPortfolios} portfolios`}
              >
                {mover.ticker}
              </span>
              <span className={`text-sm whitespace-nowrap ${isPositive ? 'text-positive' : 'text-negative'}`}>
                {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
              </span>
              <span className="text-xs text-text-secondary whitespace-nowrap">held by {mover.numPortfolios}</span>
            </Fragment>
          );
        })}
      </div>

      {/* Desktop: flex-wrap of self-contained blobs, capped at 6 (≤2 rows). */}
      <div className="hidden md:flex flex-wrap items-center gap-x-4 gap-y-1">
        {desktopMovers.map((mover) => {
          const isPositive = mover.changePercent >= 0;
          return (
            <span
              key={mover.ticker}
              className="flex items-baseline gap-1.5 whitespace-nowrap text-sm"
              title={`Held in ${mover.numPortfolios} portfolios`}
            >
              <span className="font-medium text-text-primary">{mover.ticker}</span>
              <span className={isPositive ? 'text-positive' : 'text-negative'}>
                {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
              </span>
              <span className="text-xs text-text-secondary">held by {mover.numPortfolios}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
