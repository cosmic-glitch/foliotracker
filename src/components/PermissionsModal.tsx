import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { VisibilityFields, type Visibility } from './VisibilityFields';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface PermissionsModalProps {
  portfolioId: string;
  token: string;
  onClose: () => void;
}

export function PermissionsModal({ portfolioId, token, onClose }: PermissionsModalProps) {
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [viewers, setViewers] = useState<string[]>([]);
  const [gainsOwnerOnly, setGainsOwnerOnly] = useState(false);
  const [changesOwnerOnly, setChangesOwnerOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current permissions on mount
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch permissions
        const permUrl = new URL(`${API_BASE_URL}/api/permissions`, window.location.origin);
        permUrl.searchParams.set('id', portfolioId);
        permUrl.searchParams.set('token', token);

        const permResponse = await fetch(permUrl.toString());
        if (!permResponse.ok) {
          throw new Error('Failed to load permissions');
        }

        const permData = await permResponse.json();
        setVisibility(permData.visibility);
        setViewers(permData.viewers || []);
        setGainsOwnerOnly(!!permData.gainsOwnerOnly);
        setChangesOwnerOnly(!!permData.changesOwnerOnly);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load permissions');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [portfolioId, token]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/permissions?id=${portfolioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          visibility,
          viewers,
          gainsOwnerOnly,
          changesOwnerOnly,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save permissions');
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <h3 className="text-lg font-semibold text-text-primary">
            Permissions
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-card-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm">
                {error}
              </div>
            )}

            <VisibilityFields
              portfolioId={portfolioId}
              visibility={visibility}
              onVisibilityChange={setVisibility}
              viewers={viewers}
              onViewersChange={setViewers}
            />

            <div className="space-y-2">
              <OwnerOnlySwitch
                label="Show CG tab only to me"
                description="Hide cost basis and unrealized gains from everyone else"
                checked={gainsOwnerOnly}
                onChange={setGainsOwnerOnly}
              />
              <OwnerOnlySwitch
                label="Show Changes tab only to me"
                description="Hide your holdings change log from everyone else"
                checked={changesOwnerOnly}
                onChange={setChangesOwnerOnly}
              />
              {/* Everyone but the owner gets the allocation-only view of a
                  private portfolio, which never shows either tab. */}
              {visibility === 'private' && (
                <p className="text-xs text-text-secondary">
                  While Private, both tabs are already visible only to you.
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 bg-card-hover hover:bg-border text-text-primary font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface OwnerOnlySwitchProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function OwnerOnlySwitch({ label, description, checked, onChange }: OwnerOnlySwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-card-hover text-left transition-colors"
    >
      <div className="flex-1">
        <p className="font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
