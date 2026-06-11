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

// Rounded pill directly above the Users card (spans its width). A rail — the
// word "Top movers" under a two-tone flame — names the strip and frames the
// per-row counts as "users here," which the old icon-only version left users
// guessing at. Beside it, one mover per row: ticker | day move | "(held by N
// users)", three TIGHTLY grouped columns.
//
// The three columns are kept adjacent (no flexible spacer between them) so the
// move sits right next to its ticker and the count right next to the move — a
// version that pushed the count to the pill's far right opened an awkward gap
// between a stock and its own "held by" text. The whole rail+movers cluster is
// then centered in the pill (justify-center on the parent), which fills the
// pill evenly without separating a row's own pieces.
//
// The flame is a two-tone fire (orange body + amber inner flame), not a single
// flat fill — a solid one-color flame at icon size reads as the 🔥 emoji; the
// inner highlight is what makes it read as a designed icon.
//
// Stacking the flame ABOVE the label (rather than beside it) shrinks the rail
// to the label's width, which is what lets a single row — ticker + move + the
// fully spelled-out "(held by N users)" — fit even a 360px phone. Type is a
// notch smaller on mobile (text-sm/[15px]) than desktop (text-[15px]/base) to
// hold that fit; the cluster + gap also tighten on mobile (gap-3 vs gap-5).
// Two tickers per row never fit that text, so we don't try.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers).
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  const shown = movers.slice(0, DISPLAY_COUNT);

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2.5 flex items-center justify-center gap-3 md:gap-5"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Left rail: two-tone flame above the label, vertically centered. */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <svg viewBox="0 0 20 20" width="24" height="24" aria-hidden>
          {/* Orange flame body */}
          <path
            fill="#ea580c"
            d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03z"
          />
          {/* Amber inner flame */}
          <path
            fill="#fbbf24"
            d="M12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
          />
        </svg>
        <span className="text-[15px] md:text-base font-semibold text-text-primary whitespace-nowrap">
          Top movers
        </span>
      </div>

      {/* Movers grouped tightly (ticker | move | held-by adjacent). The whole
          rail+movers cluster is centered in the pill (justify-center on the
          parent), so each row's own pieces stay together and the cluster fills
          the pill evenly instead of clumping to one side. */}
      <div className="min-w-0">
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
                  (held by {mover.numPortfolios} users)
                </span>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
