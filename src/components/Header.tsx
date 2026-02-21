import { Link } from 'react-router-dom';
import { TrendingUp, Home } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';
import { MarketStatusBadge } from './MarketStatusBadge';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  loggedInAs?: string | null;
  onEdit?: () => void;
  onPermissions?: () => void;
  onLogout?: () => void;
  showEditAndPermissions?: boolean;
}

export function Header({ marketStatus, portfolioId, loggedInAs, onEdit, onPermissions, onLogout, showEditAndPermissions }: HeaderProps) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-2 md:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors" title="All Portfolios">
              <TrendingUp className="w-6 h-6 text-accent" />
            </Link>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <Link to="/" className="hover:text-accent transition-colors hidden sm:inline">
                Folio Tracker
              </Link>
              {portfolioId && (
                <>
                  <span className="text-text-secondary font-normal">›</span>
                  <span>{portfolioId.toUpperCase()}</span>
                </>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {marketStatus && <div className="hidden sm:flex"><MarketStatusBadge status={marketStatus} /></div>}
            {loggedInAs && onLogout && (
              <UserMenu
                loggedInAs={loggedInAs}
                onEdit={onEdit}
                onPermissions={onPermissions}
                onLogout={onLogout}
                showEditAndPermissions={showEditAndPermissions}
              />
            )}
            <Link to="/" className="flex items-center gap-1.5 p-2 hover:bg-card rounded-lg transition-colors text-text-secondary text-sm" title="All Portfolios">
              <Home className="w-5 h-5" />
              <span className="hidden sm:inline">Home</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
