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
// Both layouts are CSS grids of N entry-columns, each split into three tracks
// (ticker | % | held-by). Entries flow row-major into those tracks, so within
// each column the tickers, percentages, and "held by" counts line up
// independently — far easier to scan than the ragged flex-wrap this replaced.
// Movers arrive pre-sorted by significance (breadth × |move|), so slicing keeps
// the most important ones. The breakpoint is `lg`, not `md`, because three
// entry-columns only fit once the left column is wide enough (~518px of strip
// space at lg+, where `max-w-4xl` has capped the container):
//   • Below lg (mobile + tablet): two entry-columns, capped at 4 (2×2). The
//     two-column grid is ~309px, which fits even the ~392px md tablet width.
//   • lg+: three entry-columns, capped at 6 (3×2). The three-column grid is
//     ~480px for typical 1–4-char tickers, comfortably inside the ~518px the
//     strip gets once the page hits its max width. A truncated tail drops the
//     least significant names.
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  const narrowMovers = movers.slice(0, 4);
  const wideMovers = movers.slice(0, 6);

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2 flex items-center gap-2 md:gap-4"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Flame lives outside the layout containers so wrapped rows start at the
          same x as the first row's text instead of under the icon. */}
      <Flame className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />

      {/* Below lg: aligned two-column grid (ticker | % | held-by per column). */}
      <div className="lg:hidden grid grid-cols-[auto_auto_auto_auto_auto_auto] items-baseline gap-x-1.5 gap-y-1">
        {narrowMovers.map((mover, i) => {
          const isPositive = mover.changePercent >= 0;
          const newColumn = i % 2 !== 0;
          return (
            <Fragment key={mover.ticker}>
              <span
                className={`font-medium text-text-primary text-sm whitespace-nowrap ${newColumn ? 'pl-4' : ''}`}
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

      {/* lg+: aligned three-column grid (ticker | % | held-by per column). Same
          row-major-into-tracks scheme as the narrow layout, just three columns
          (9 tracks) instead of two. pl-5 on every entry past the first in its
          row gives the columns breathing room between them. */}
      <div className="hidden lg:grid grid-cols-[auto_auto_auto_auto_auto_auto_auto_auto_auto] items-baseline gap-x-1.5 gap-y-1">
        {wideMovers.map((mover, i) => {
          const isPositive = mover.changePercent >= 0;
          const newColumn = i % 3 !== 0;
          return (
            <Fragment key={mover.ticker}>
              <span
                className={`font-medium text-text-primary text-sm whitespace-nowrap ${newColumn ? 'pl-5' : ''}`}
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
    </div>
  );
}
