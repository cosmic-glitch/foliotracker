import { Flame } from 'lucide-react';

export interface MarketMover {
  ticker: string;
  changePercent: number;
  numPortfolios: number;
}

interface MoversStripProps {
  movers: MarketMover[];
}

// Slim ticker strip between the landing-page header and the Users card.
// Shows the most-held names swinging ≥2% today (criteria computed server-side
// in api/portfolios.ts). Renders nothing on quiet days — an empty strip beats
// training users that it's filler.
export function MoversStrip({ movers }: MoversStripProps) {
  if (movers.length === 0) return null;

  return (
    <div className="border-b border-border bg-card/30" aria-label="Today's movers among tracked holdings">
      <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Flame className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />
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
