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
// Shows the most-held names swinging ≥2% today (criteria computed server-side
// in api/portfolios.ts). Renders nothing on quiet days — an empty strip beats
// training users that it's filler.
//
// Entries wrap to extra rows when the width runs out — no horizontal scroll
// (touch-scroll proved unreliable on mobile, and clipped entries looked
// broken). rounded-3xl clamps to a pill when one row fits and relaxes to a
// rounded lozenge when wrapped.
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2 flex items-center gap-4"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Flame lives outside the wrap container so wrapped rows start at the
          same x as the first row's text instead of under the icon. */}
      <Flame className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {movers.map((mover) => {
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
