import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent } from '../utils/formatters';

interface TotalValueProps {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalGain: number | null;
  totalGainPercent: number | null;
}

export function TotalValue({ totalValue, dayChange, dayChangePercent, totalGain, totalGainPercent }: TotalValueProps) {
  const isPositive = dayChange >= 0;
  const DayIcon = isPositive ? TrendingUp : TrendingDown;
  const dayChangeColor = isPositive ? 'text-positive' : 'text-negative';
  const dayBgColor = isPositive ? 'bg-positive/10' : 'bg-negative/10';

  const gainIsPositive = totalGain !== null ? totalGain >= 0 : true;
  const GainIcon = gainIsPositive ? TrendingUp : TrendingDown;
  const gainColor = gainIsPositive ? 'text-positive' : 'text-negative';
  const gainBgColor = gainIsPositive ? 'bg-positive/10' : 'bg-negative/10';

  return (
    <div className="bg-card rounded-2xl px-2.5 py-3 sm:px-6 sm:py-4 md:px-8 md:py-5 border border-border">
      <div className="flex flex-row items-stretch justify-between gap-2 md:gap-4">
        <div className="min-w-0 flex-shrink">
          <p className="text-text-secondary text-sm font-medium mb-1">Portfolio Value</p>
          <p className="text-2xl md:text-5xl font-bold text-text-primary tracking-tight">
            {formatCurrency(totalValue)}
          </p>
        </div>
        <div className="flex flex-row items-stretch gap-1.5 sm:gap-2 md:gap-3">
          <div className={`flex items-center gap-1 sm:gap-1.5 md:gap-3 px-1.5 py-1 sm:px-2.5 sm:py-1.5 md:px-4 md:py-3 rounded-xl ${dayBgColor}`}>
            <DayIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-5 md:h-5 ${dayChangeColor}`} />
            <div className="flex flex-col">
              <span className={`text-xs sm:text-sm md:text-lg font-semibold ${dayChangeColor}`}>
                {formatChange(dayChange, true)}
              </span>
              <span className={`text-[10px] sm:text-[11px] md:text-sm ${dayChangeColor}`}>
                {formatPercent(dayChangePercent)} today
              </span>
            </div>
          </div>
          {totalGain !== null && totalGainPercent !== null && (
              <div className={`flex items-center gap-1 sm:gap-1.5 md:gap-3 px-1.5 py-1 sm:px-2.5 sm:py-1.5 md:px-4 md:py-3 rounded-xl ${gainBgColor}`}>
                <GainIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-5 md:h-5 ${gainColor}`} />
                <div className="flex flex-col">
                  <span className={`text-xs sm:text-sm md:text-lg font-semibold ${gainColor}`}>
                    {formatChange(totalGain, true)}
                  </span>
                  <span className={`text-[10px] sm:text-[11px] md:text-sm ${gainColor}`}>
                    unrealized gain
                  </span>
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
}
