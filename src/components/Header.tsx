import { Link } from 'react-router-dom';
import { TrendingUp, Home } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';
import { MarketStatusBadge } from './MarketStatusBadge';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  displayName?: string | null;
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
