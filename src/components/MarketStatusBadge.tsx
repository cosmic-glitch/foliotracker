import type { MarketStatus } from '../types/portfolio';

interface MarketStatusBadgeProps {
  status: MarketStatus;
}

export function MarketStatusBadge({ status }: MarketStatusBadgeProps) {
  const config: Record<MarketStatus, { label: string; shortLabel: string; color: string; dotColor: string }> = {
    'open': { label: 'Market Open', shortLabel: 'Mkt Open', color: 'text-positive', dotColor: 'bg-positive' },
    'pre-market': { label: 'Pre-Market', shortLabel: 'Pre-Mkt', color: 'text-amber-500', dotColor: 'bg-amber-500' },
    'after-hours': { label: 'After Hours', shortLabel: 'After Hrs', color: 'text-amber-500', dotColor: 'bg-amber-500' },
    'closed': { label: 'Market Closed', shortLabel: 'Mkt Closed', color: 'text-text-secondary', dotColor: 'bg-text-secondary' },
  };

  const { label, shortLabel, color, dotColor } = config[status];

  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor} ${status === 'open' ? 'animate-pulse' : ''}`} />
      <span className="hidden md:inline">{label}</span>
      <span className="md:hidden">{shortLabel}</span>
    </div>
  );
}
