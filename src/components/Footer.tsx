import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { formatDate } from '../utils/formatters';
import { InstallModal } from './InstallModal';

interface FooterProps {
  lastUpdated: Date;
}

export function Footer({ lastUpdated }: FooterProps) {
  const [showInstallModal, setShowInstallModal] = useState(false);

  return (
    <>
      <footer className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <p className="text-text-secondary text-sm">
              Last updated: {formatDate(lastUpdated)}
            </p>
            <button
              onClick={() => setShowInstallModal(true)}
              className="flex items-center gap-1.5 text-text-secondary hover:text-accent transition-colors text-sm"
            >
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">Set up as an app on your phone</span>
              <span className="sm:hidden">Set up as phone app</span>
            </button>
          </div>
        </div>
      </footer>

      {showInstallModal && (
        <InstallModal onClose={() => setShowInstallModal(false)} />
      )}
    </>
  );
}
