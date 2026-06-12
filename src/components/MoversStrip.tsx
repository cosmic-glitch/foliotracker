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

// How many movers the pill shows (one per row). The server floors the list at
// the same count (MOVER_MIN_COUNT in api/portfolios.ts) so the rows are never
// short; keep the two in sync.
const DISPLAY_COUNT = 4;

// Rounded pill directly above the Users card (spans its width). A left rail —
// the word "Top movers" under a flame — names the strip and frames the per-row
// counts as "users here," which the old icon-only version left users guessing
// at. The rail is anchored to the pill's LEFT edge (a label, echoing the
// left-aligned Users heading below); the movers sit centered in its leftover
// width. Each mover is one row: ticker | day move | "(held by N users)", three
// TIGHTLY grouped columns.
//
// The three columns are kept adjacent (no flexible spacer between them) so the
// move sits right next to its ticker and the count right next to the move — a
// version that pushed the count to the pill's far right opened an awkward gap
// between a stock and its own "held by" text. The movers block then centers in
// the rail's leftover space (flex-1 + justify-center), which keeps a row's own
// pieces together while filling the pill.
//
// The flame is the lucide-react Flame icon — a single-color, thin-stroke line
// flame in amber (text-amber-500), monochromatic with no second shade. This is
// the original look the user preferred; it renders identically across platforms
// (unlike the native 🔥 emoji, which the platform paints in its own multi-shaded
// art). A native emoji and a two-tone SVG are both kept in git history.
//
// Stacking the flame ABOVE the label (rather than beside it) shrinks the rail
// to the label's width, which is what lets a single row — ticker + move + the
// fully spelled-out "(held by N users)" — fit even a 360px phone. Type is a
// notch smaller on mobile (text-sm/[15px]) than desktop (text-[15px]/base) to
// hold that fit; the gap also tightens on mobile (gap-3 vs gap-5). Two tickers
// per row never fit that text, so we don't try.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers).
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  const shown = movers.slice(0, DISPLAY_COUNT);

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2.5 flex items-center gap-3 md:gap-5"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Left rail: flame above the label, anchored to the pill's left edge so
          it reads as a label (echoing the left-aligned Users heading below). */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        {/* The lucide Flame icon: a single-color, thin-stroke flame in amber —
            monochromatic (no second shade), and identical across platforms. This
            is the original look the user preferred over the native 🔥 emoji. */}
        <Flame className="w-4 h-4 text-amber-500" aria-hidden />
        <span className="text-[15px] md:text-base font-semibold text-text-primary whitespace-nowrap">
          Top movers
        </span>
      </div>

      {/* Movers grouped tightly (ticker | move | held-by adjacent) and centered
          in the rail's leftover width (flex-1 + justify-center), so the rail
          sits to the left as a label while the data centers in the pill and a
          row's own pieces never separate. */}
      <div className="flex-1 flex justify-center min-w-0">
        <div className="grid grid-cols-[auto_auto_auto] items-baseline gap-x-3 gap-y-1">
          {shown.map((mover) => {
            const isPositive = mover.changePercent >= 0;
            return (
              <Fragment key={mover.ticker}>
                <span className="font-semibold text-text-primary text-sm md:text-[15px] whitespace-nowrap">
                  {mover.ticker}
                </span>
                <span className={`text-sm md:text-[15px] tabular-nums text-right whitespace-nowrap ${isPositive ? 'text-positive' : 'text-negative'}`}>
                  {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
                </span>
                <span className="text-xs text-text-secondary whitespace-nowrap">
                  (held by {mover.numPortfolios} {mover.numPortfolios === 1 ? 'user' : 'users'})
                </span>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
