import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Home, Share2, Check } from 'lucide-react';
import type { MarketStatus } from '../types/portfolio';
import { MarketStatusBadge } from './MarketStatusBadge';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  marketStatus?: MarketStatus;
  portfolioId?: string;
  displayName?: string | null;
}

export function Header({ marketStatus, portfolioId, displayName }: HeaderProps) {
  const [copied, setCopied] = useState(false);

  // If we have a portfolioId but no displayName yet, show generic title while loading
  const title = portfolioId
    ? (displayName || 'Portfolio')
    : 'FolioTracker';

  const handleShare = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
            {portfolioId && (
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 p-2 hover:bg-card rounded-lg transition-colors text-sm"
                title="Copy link"
              >
                {copied ? (
                  <>
                    <Check className="w-5 h-5 text-positive" />
                    <span className="text-positive">Portfolio link copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-5 h-5 text-text-secondary" />
                    <span className="text-text-secondary">Share</span>
                  </>
                )}
              </button>
            )}
            <ThemeToggle />
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
