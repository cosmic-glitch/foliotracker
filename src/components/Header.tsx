import { Link } from 'react-router-dom';
import { TrendingUp, Home, Pencil, Settings, User, LogOut } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';
import { MarketStatusBadge } from './MarketStatusBadge';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  loggedInAs?: string | null;
  onEdit?: () => void;
  onPermissions?: () => void;
  onLogout?: () => void;
}

export function Header({ marketStatus, portfolioId, loggedInAs, onEdit, onPermissions, onLogout }: HeaderProps) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-4">
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
            {loggedInAs && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 rounded-lg">
                <User className="w-3.5 h-3.5 text-accent" />
                <span className="text-sm font-medium text-accent">
                  {loggedInAs.toUpperCase()}
                </span>
              </div>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 p-2 hover:bg-card hover:text-accent rounded-lg transition-colors text-sm text-text-secondary"
                title="Edit portfolio"
              >
                <Pencil className="w-5 h-5" />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}
            {/* Show Permissions button only when logged in as this portfolio */}
            {onPermissions && loggedInAs && portfolioId && loggedInAs === portfolioId.toLowerCase() && (
              <button
                onClick={onPermissions}
                className="flex items-center gap-1.5 p-2 hover:bg-card hover:text-accent rounded-lg transition-colors text-sm text-text-secondary"
                title="Manage permissions"
              >
                <Settings className="w-5 h-5" />
                <span className="hidden sm:inline">Permissions</span>
              </button>
            )}
            {onLogout && loggedInAs && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 p-2 hover:bg-card hover:text-accent rounded-lg transition-colors text-sm text-text-secondary"
                title="Log out"
              >
                <LogOut className="w-5 h-5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
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
