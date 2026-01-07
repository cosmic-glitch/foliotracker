import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent } from '../utils/formatters';
import type { BenchmarkData } from '../types/portfolio';

interface TotalValueProps {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  benchmark: BenchmarkData | null;
}

export function TotalValue({ totalValue, dayChange, dayChangePercent, benchmark }: TotalValueProps) {
  const isPositive = dayChange >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const changeColor = isPositive ? 'text-positive' : 'text-negative';
  const bgColor = isPositive ? 'bg-positive/10' : 'bg-negative/10';

  const benchmarkIsPositive = benchmark ? benchmark.dayChangePercent >= 0 : true;
  const benchmarkColor = benchmarkIsPositive ? 'text-positive' : 'text-negative';

  return (
    <div className="bg-card rounded-2xl p-6 md:p-8 border border-border">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-text-secondary text-sm font-medium mb-2">Total Portfolio Value</p>
          <p className="text-4xl md:text-5xl font-bold text-text-primary tracking-tight">
            {formatCurrency(totalValue)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${bgColor}`}>
            <Icon className={`w-5 h-5 ${changeColor}`} />
            <div className="flex flex-col">
              <span className={`text-lg font-semibold ${changeColor}`}>
                {formatChange(dayChange, true)}
              </span>
              <span className={`text-sm ${changeColor}`}>
                {formatPercent(dayChangePercent)} today
              </span>
            </div>
          </div>
          {benchmark && (
            <div className="flex flex-col items-center px-4 py-3 rounded-xl bg-background border border-border">
              <span className={`text-lg font-semibold ${benchmarkColor}`}>
                {benchmark.dayChangePercent >= 0 ? '+' : ''}{benchmark.dayChangePercent.toFixed(2)}%
              </span>
              <span className="text-xs text-text-secondary">
                {benchmark.name}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
