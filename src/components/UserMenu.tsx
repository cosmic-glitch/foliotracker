import { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, Pencil, Settings, LogOut, Sun, Moon, Clock, Link2, CalendarRange } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useExtendedHours } from '../context/ExtendedHoursContext';
import { useTimeframe } from '../context/TimeframeContext';

interface UserMenuProps {
  loggedInAs: string;
  onEdit?: () => void;
  onPermissions?: () => void;
  onShare?: () => void;
  onLogout: () => void;
  showEditAndPermissions?: boolean;
}

export function UserMenu({ loggedInAs, onEdit, onPermissions, onShare, onLogout, showEditAndPermissions = true }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { showExtendedHours, toggleExtendedHours } = useExtendedHours();
  const { timeframe, toggleTimeframe } = useTimeframe();

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 rounded-lg hover:bg-accent/15 transition-colors cursor-pointer"
      >
        <User className="w-3.5 h-3.5 text-accent" />
        <span className="text-sm font-medium text-accent">
          {loggedInAs.toUpperCase()}
        </span>
        <ChevronDown className={`w-3 h-3 text-accent transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-card border border-border rounded-xl shadow-lg min-w-[200px] py-1.5 z-50 animate-[fadeIn_0.15s_ease-out]">
          {showEditAndPermissions && onEdit && (
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
            >
              <Pencil className="w-4 h-4 text-text-secondary" />
              Edit Portfolio
            </button>
          )}
          {showEditAndPermissions && onPermissions && (
            <button
              onClick={() => { setOpen(false); onPermissions(); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
            >
              <Settings className="w-4 h-4 text-text-secondary" />
              Permissions
            </button>
          )}
          {showEditAndPermissions && onShare && (
            <button
              onClick={() => { setOpen(false); onShare(); }}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
            >
              <Link2 className="w-4 h-4 text-text-secondary" />
              Share
            </button>
          )}
          {showEditAndPermissions && (onEdit || onPermissions || onShare) && (
            <div className="mx-3 my-1 border-t border-border" />
          )}
          <button
            onClick={toggleTheme}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-text-secondary" />
                Light Mode
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-text-secondary" />
                Dark Mode
              </>
            )}
          </button>
          <button
            onClick={toggleExtendedHours}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
          >
            <Clock className="w-4 h-4 text-text-secondary" />
            Extended Hours
            <span className={`ml-auto w-4 h-4 rounded border flex items-center justify-center text-xs ${
              showExtendedHours
                ? 'bg-accent border-accent text-white'
                : 'border-border'
            }`}>
              {showExtendedHours && '✓'}
            </span>
          </button>
          {/* Global 1D/30D view — drives the landing list, the portfolio
              page's TotalValue headline, and the chart together. Same
              check-row pattern as Extended Hours above. */}
          <button
            onClick={toggleTimeframe}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-card-hover transition-colors"
          >
            <CalendarRange className="w-4 h-4 text-text-secondary" />
            30-Day View
            <span className={`ml-auto w-4 h-4 rounded border flex items-center justify-center text-xs ${
              timeframe === '30d'
                ? 'bg-accent border-accent text-white'
                : 'border-border'
            }`}>
              {timeframe === '30d' && '✓'}
            </span>
          </button>
          <div className="mx-3 my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-text-primary hover:bg-negative/10 hover:text-negative transition-colors"
          >
            <LogOut className="w-4 h-4 text-text-secondary" />
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
