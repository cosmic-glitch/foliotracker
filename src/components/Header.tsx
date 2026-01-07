import { Link } from 'react-router-dom';
import { TrendingUp, Home } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  displayName?: string | null;
}

function MarketStatusBadge({ status }: { status: MarketStatus }) {
  const config: Record<MarketStatus, { label: string; color: string; dotColor: string }> = {
    'open': { label: 'Market Open', color: 'text-positive', dotColor: 'bg-positive' },
    'pre-market': { label: 'Pre-Market', color: 'text-amber-500', dotColor: 'bg-amber-500' },
    'after-hours': { label: 'After Hours', color: 'text-amber-500', dotColor: 'bg-amber-500' },
    'closed': { label: 'Market Closed', color: 'text-text-secondary', dotColor: 'bg-text-secondary' },
  };

  const { label, color, dotColor } = config[status];

  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor} ${status === 'open' ? 'animate-pulse' : ''}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

export function Header({ marketStatus, portfolioId, displayName }: HeaderProps) {
  // If we have a portfolioId but no displayName yet, show generic title while loading
  const title = portfolioId
    ? (displayName || 'Portfolio')
    : 'FolioTracker';

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors" title="All Portfolios">
              <TrendingUp className="w-6 h-6 text-accent" />
            </Link>
            <h1 className="text-xl font-semibold text-text-primary">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {marketStatus && <MarketStatusBadge status={marketStatus} />}
            <Link to="/" className="p-2 hover:bg-card rounded-lg transition-colors" title="All Portfolios">
              <Home className="w-5 h-5 text-text-secondary" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
