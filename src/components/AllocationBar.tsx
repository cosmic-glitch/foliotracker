import { formatCurrency } from '../utils/formatters';

export function AllocationBar({ percent, maxPercent, value }: { percent: number; maxPercent: number; value: number }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1">
        <div
          className="h-5 bg-accent/80 rounded transition-all duration-500 flex items-center justify-end px-1.5"
          style={{ width: `${scaledWidth}%`, minWidth: 'fit-content' }}
        >
          <span className="text-xs font-medium text-white/90">{percent.toFixed(1)}%</span>
        </div>
      </div>
      <span className="text-xs text-text-secondary shrink-0">{formatCurrency(value, true)}</span>
    </div>
  );
}
