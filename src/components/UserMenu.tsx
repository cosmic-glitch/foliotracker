import { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, Pencil, Settings, LogOut } from 'lucide-react';

interface UserMenuProps {
  loggedInAs: string;
  onEdit?: () => void;
  onPermissions?: () => void;
  onLogout: () => void;
  showEditAndPermissions?: boolean;
}

export function UserMenu({ loggedInAs, onEdit, onPermissions, onLogout, showEditAndPermissions = true }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
          {showEditAndPermissions && (onEdit || onPermissions) && (
            <div className="mx-3 my-1 border-t border-border" />
          )}
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
