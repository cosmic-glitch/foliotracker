import { Link } from 'react-router-dom';
import { TrendingUp, Home, Pencil, Settings, User } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';
import { MarketStatusBadge } from './MarketStatusBadge';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  loggedInAs?: string | null;
  onEdit?: () => void;
  onPermissions?: () => void;
}

export function Header({ marketStatus, portfolioId, loggedInAs, onEdit, onPermissions }: HeaderProps) {
  const title = 'Folio Tracker';

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
            {loggedInAs && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 rounded-lg">
                <User className="w-3.5 h-3.5 text-accent" />
                <span className="text-sm font-medium text-accent">
                  {loggedInAs.toUpperCase()}
                </span>
              </div>
            )}
            {marketStatus && <MarketStatusBadge status={marketStatus} />}
            {/* Show Permissions button only when logged in as this portfolio */}
            {onPermissions && loggedInAs && portfolioId && loggedInAs === portfolioId.toLowerCase() && (
              <button
                onClick={onPermissions}
                className="flex items-center gap-1.5 p-2 hover:bg-card hover:text-accent rounded-lg transition-colors text-sm text-text-secondary"
                title="Manage permissions"
              >
                <Settings className="w-5 h-5" />
                <span>Permissions</span>
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 p-2 hover:bg-card hover:text-accent rounded-lg transition-colors text-sm text-text-secondary"
                title="Edit portfolio"
              >
                <Pencil className="w-5 h-5" />
                <span>Edit</span>
              </button>
            )}
            <Link to="/" className="flex items-center gap-1.5 p-2 hover:bg-card rounded-lg transition-colors text-text-secondary text-sm" title="All Portfolios">
              <Home className="w-5 h-5" />
              <span>Home</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
