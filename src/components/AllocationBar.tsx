export function AllocationBar({ percent, maxPercent, compact }: { percent: number; maxPercent: number; compact?: boolean }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 ${compact ? 'h-2' : 'h-3'} bg-background rounded-full overflow-hidden`}>
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${scaledWidth}%` }}
        />
      </div>
      <span className="text-text-secondary text-sm w-14 text-right">
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}
