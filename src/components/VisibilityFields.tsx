import { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import { Globe, Lock, Users, Trash2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export type Visibility = 'public' | 'private' | 'selective';

const OPTIONS: { value: Visibility; label: string; description: string; Icon: ComponentType<{ className?: string }> }[] = [
  { value: 'public', label: 'Public', description: 'Anyone can view', Icon: Globe },
  { value: 'private', label: 'Private', description: 'Only you (with password)', Icon: Lock },
  { value: 'selective', label: 'Selective', description: 'Only specific users (when logged in)', Icon: Users },
];

interface VisibilityFieldsProps {
  /** The portfolio being configured — excluded from the viewer picker. */
  portfolioId: string;
  visibility: Visibility;
  onVisibilityChange: (visibility: Visibility) => void;
  viewers: string[];
  onViewersChange: (viewers: string[]) => void;
}

/** Visibility picker + selective-viewer list, shared by Create Portfolio and the Permissions modal. */
export function VisibilityFields({
  portfolioId,
  visibility,
  onVisibilityChange,
  viewers,
  onViewersChange,
}: VisibilityFieldsProps) {
  const [allPortfolios, setAllPortfolios] = useState<string[]>([]);

  useEffect(() => {
    async function fetchPortfolios() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/portfolios`);
        if (response.ok) {
          const data = await response.json();
          setAllPortfolios(data.portfolios.map((p: { id: string }) => p.id.toLowerCase()));
        }
      } catch (err) {
        console.error('Failed to fetch portfolios:', err);
      }
    }
    fetchPortfolios();
  }, []);

  const availablePortfolios = allPortfolios.filter(
    (id) => id !== portfolioId.toLowerCase() && !viewers.includes(id)
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-text-primary">
        Who can view this portfolio?
      </label>

      <div className="space-y-2">
        {OPTIONS.map(({ value, label, description, Icon }) => (
          <label
            key={value}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              visibility === value
                ? 'border-accent bg-accent/5'
                : 'border-border hover:bg-card-hover'
            }`}
          >
            <input
              type="radio"
              name="visibility"
              value={value}
              checked={visibility === value}
              onChange={() => onVisibilityChange(value)}
              className="sr-only"
            />
            <Icon className={`w-5 h-5 ${visibility === value ? 'text-accent' : 'text-text-secondary'}`} />
            <div>
              <p className="font-medium text-text-primary">{label}</p>
              <p className="text-xs text-text-secondary">{description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* allocation_public is always true (no longer user-settable): restricted
          visitors still get the allocation-only view. */}
      {visibility !== 'public' && (
        <p className="text-xs text-text-secondary">
          Allocation percentages are always visible to everyone. Dollar amounts and share counts stay hidden.
        </p>
      )}

      {visibility === 'selective' && (
        <div className="pt-1 space-y-3">
          <p className="text-xs text-text-secondary">
            Add users who can view this portfolio when they're logged in.
          </p>

          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (value && !viewers.includes(value)) {
                onViewersChange([...viewers, value]);
              }
            }}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
          >
            <option value="">Select a user</option>
            {availablePortfolios.map((id) => (
              <option key={id} value={id}>
                {id.toUpperCase()}
              </option>
            ))}
          </select>

          {viewers.length > 0 ? (
            <div className="bg-background rounded-lg border border-border divide-y divide-border">
              {viewers.map((viewerId) => (
                <div key={viewerId} className="flex items-center justify-between px-3 py-2">
                  <span className="text-text-primary font-medium">
                    {viewerId.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onViewersChange(viewers.filter((v) => v !== viewerId))}
                    className="p-1 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary text-center py-4 bg-background rounded-lg border border-border">
              No viewers added yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
