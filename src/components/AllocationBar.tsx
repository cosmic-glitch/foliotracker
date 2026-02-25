export function AllocationBar({ percent, maxPercent }: { percent: number; maxPercent: number }) {
  // Scale the bar relative to the max allocation so the largest fills the bar
  const scaledWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;
  const labelInside = scaledWidth >= 12;

  return (
    <div className="flex items-center">
      <div className="flex-1 flex items-center gap-1">
        <div
          className="h-5 bg-accent/80 rounded transition-all duration-500 flex items-center justify-end px-1.5"
          style={{ width: `${scaledWidth}%` }}
        >
          {labelInside && (
            <span className="text-xs font-medium text-white/90">{percent.toFixed(1)}%</span>
          )}
        </div>
        {!labelInside && (
          <span className="text-xs font-medium text-text-secondary">{percent.toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}
