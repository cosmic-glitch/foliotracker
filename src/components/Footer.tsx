import { useState } from 'react';
import { RefreshCw, Smartphone } from 'lucide-react';
import { formatDate } from '../utils/formatters';
import { InstallModal } from './InstallModal';

interface FooterProps {
  lastUpdated: Date;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function Footer({ lastUpdated, onRefresh, isRefreshing }: FooterProps) {
  const [showInstallModal, setShowInstallModal] = useState(false);

  return (
    <>
      <footer className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-4">
              <p className="text-text-secondary text-sm">
                Last updated: {formatDate(lastUpdated)}
              </p>
              <button
                onClick={() => setShowInstallModal(true)}
                className="flex items-center gap-1.5 text-text-secondary hover:text-accent transition-colors text-sm"
              >
                <Smartphone className="w-4 h-4" />
                <span className="hidden sm:inline">Setup as an app on your phone</span>
                <span className="sm:hidden">Setup as app</span>
              </button>
            </div>
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 text-accent hover:text-accent/80 transition-colors text-sm font-medium disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>
        </div>
      </footer>

      {showInstallModal && (
        <InstallModal onClose={() => setShowInstallModal(false)} />
      )}
    </>
  );
}
