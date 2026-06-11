import { Fragment } from 'react';

export interface MarketMover {
  ticker: string;
  changePercent: number;
  numPortfolios: number;
}

interface MoversStripProps {
  movers: MarketMover[];
}

// How many movers the pill shows (one per row). The server floors the list at
// the same count (MOVER_MIN_COUNT in api/portfolios.ts) so the rows are never
// short; keep the two in sync.
const DISPLAY_COUNT = 3;

// Rounded pill directly above the Users card (spans its width). A left rail —
// the word "Top movers" under a filled flame — names the strip and frames the
// per-row counts as "users here," which the old icon-only version left users
// guessing at. To its right, one mover per row: ticker + day move grouped on
// the left, "(held by N users)" anchored to the pill's right edge.
//
// The mover grid takes the rail's leftover width (flex-1) and a flexible final
// column (`auto auto 1fr`) pushes the held-by context to the far right, so each
// row spans the full pill rather than clumping on the left and leaving the
// right half empty. ticker+move read together as the headline; the count reads
// as right-aligned context, like a leaderboard.
//
// Same layout at every width. Stacking the flame ABOVE the label (rather than
// beside it) shrinks the rail to the label's width, which is what lets a single
// row — ticker + move + the fully spelled-out "(held by N users)" — fit even a
// 360px phone. Two tickers per row never fit that text, so we don't try.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers).
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  const shown = movers.slice(0, DISPLAY_COUNT);

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2 flex items-center gap-3"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Left rail: filled flame above the label, vertically centered. The
          13px label keeps the rail narrow enough for the 360px fit. */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="currentColor"
          className="text-orange-500"
          aria-hidden
        >
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
        <span className="text-[13px] font-semibold text-text-primary whitespace-nowrap">
          Top movers
        </span>
      </div>

      {/* One mover per row: ticker + move grouped on the left, the held-by
          context anchored to the right edge by a flexible final column, so each
          row spans the full pill instead of clumping on the left. */}
      <div className="grid flex-1 min-w-0 grid-cols-[auto_auto_1fr] items-baseline gap-x-3 gap-y-1">
        {shown.map((mover) => {
          const isPositive = mover.changePercent >= 0;
          return (
            <Fragment key={mover.ticker}>
              <span className="font-medium text-text-primary text-sm whitespace-nowrap">
                {mover.ticker}
              </span>
              <span className={`text-sm tabular-nums whitespace-nowrap ${isPositive ? 'text-positive' : 'text-negative'}`}>
                {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
              </span>
              <span className="text-xs text-text-secondary whitespace-nowrap justify-self-end">
                (held by {mover.numPortfolios} users)
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
