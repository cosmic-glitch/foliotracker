export function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Total Value Skeleton */}
      <div className="bg-card rounded-2xl p-6 md:p-8 border border-border">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="h-4 w-32 bg-card-hover rounded mb-3" />
            <div className="h-12 w-64 bg-card-hover rounded" />
          </div>
          <div className="h-16 w-40 bg-card-hover rounded-xl" />
        </div>
      </div>

      {/* Chart Skeleton */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="h-5 w-40 bg-card-hover rounded mb-4" />
        <div className="h-64 md:h-80 bg-card-hover rounded-lg" />
      </div>

      {/* Holdings Skeleton */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="h-5 w-24 bg-card-hover rounded" />
        </div>
        <div className="divide-y divide-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 w-16 bg-card-hover rounded mb-2" />
                <div className="h-3 w-32 bg-card-hover rounded" />
              </div>
              <div className="h-4 w-20 bg-card-hover rounded" />
              <div className="h-2 w-24 bg-card-hover rounded" />
              <div className="h-4 w-28 bg-card-hover rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
