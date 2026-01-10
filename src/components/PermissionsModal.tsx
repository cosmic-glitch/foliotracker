import { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2, Globe, Lock, Users } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

type Visibility = 'public' | 'private' | 'selective';

interface PermissionsModalProps {
  portfolioId: string;
  password: string;
  onClose: () => void;
}

export function PermissionsModal({ portfolioId, password, onClose }: PermissionsModalProps) {
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [viewers, setViewers] = useState<string[]>([]);
  const [selectedViewer, setSelectedViewer] = useState('');
  const [allPortfolios, setAllPortfolios] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current permissions and all portfolios on mount
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch permissions
        const permUrl = new URL(`${API_BASE_URL}/api/permissions`, window.location.origin);
        permUrl.searchParams.set('id', portfolioId);
        permUrl.searchParams.set('password', password);

        const permResponse = await fetch(permUrl.toString());
        if (!permResponse.ok) {
          throw new Error('Failed to load permissions');
        }

        const permData = await permResponse.json();
        setVisibility(permData.visibility);
        setViewers(permData.viewers || []);

        // Fetch all portfolios
        const portfoliosResponse = await fetch(`${API_BASE_URL}/api/portfolios`);
        if (portfoliosResponse.ok) {
          const portfoliosData = await portfoliosResponse.json();
          const ids = portfoliosData.portfolios.map((p: { id: string }) => p.id.toLowerCase());
          setAllPortfolios(ids);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load permissions');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [portfolioId, password]);

  const handleAddViewer = () => {
    if (!selectedViewer) return;
    if (viewers.includes(selectedViewer)) {
      setError('This user is already in the list');
      return;
    }
    setViewers([...viewers, selectedViewer]);
    setSelectedViewer('');
    setError(null);
  };

  // Get available portfolios (exclude self and already added viewers)
  const availablePortfolios = allPortfolios.filter(
    (id) => id !== portfolioId.toLowerCase() && !viewers.includes(id)
  );

  const handleRemoveViewer = (viewerId: string) => {
    setViewers(viewers.filter((v) => v !== viewerId));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/permissions?id=${portfolioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          visibility,
          viewers,
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
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6">
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

            {/* Visibility Options */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-text-primary">
                Who can view this portfolio?
              </label>

              <div className="space-y-2">
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility === 'public'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:bg-card-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={(e) => setVisibility(e.target.value as Visibility)}
                    className="sr-only"
                  />
                  <Globe className={`w-5 h-5 ${visibility === 'public' ? 'text-accent' : 'text-text-secondary'}`} />
                  <div>
                    <p className="font-medium text-text-primary">Public</p>
                    <p className="text-xs text-text-secondary">Anyone can view</p>
                  </div>
                </label>

                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility === 'private'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:bg-card-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={(e) => setVisibility(e.target.value as Visibility)}
                    className="sr-only"
                  />
                  <Lock className={`w-5 h-5 ${visibility === 'private' ? 'text-accent' : 'text-text-secondary'}`} />
                  <div>
                    <p className="font-medium text-text-primary">Private</p>
                    <p className="text-xs text-text-secondary">Only you (with password)</p>
                  </div>
                </label>

                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility === 'selective'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:bg-card-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="selective"
                    checked={visibility === 'selective'}
                    onChange={(e) => setVisibility(e.target.value as Visibility)}
                    className="sr-only"
                  />
                  <Users className={`w-5 h-5 ${visibility === 'selective' ? 'text-accent' : 'text-text-secondary'}`} />
                  <div>
                    <p className="font-medium text-text-primary">Selective</p>
                    <p className="text-xs text-text-secondary">Only specific users (when logged in)</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Viewers List (only for selective) */}
            {visibility === 'selective' && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-text-primary">
                  Allowed Viewers
                </label>
                <p className="text-xs text-text-secondary">
                  Add users who can view this portfolio when they're logged in.
                </p>

                <div className="flex gap-2">
                  <select
                    value={selectedViewer}
                    onChange={(e) => setSelectedViewer(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                  >
                    <option value="">Select a user</option>
                    {availablePortfolios.map((id) => (
                      <option key={id} value={id}>
                        {id.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddViewer}
                    disabled={!selectedViewer}
                    className="px-3 py-2 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {viewers.length > 0 ? (
                  <div className="bg-background rounded-lg border border-border divide-y divide-border">
                    {viewers.map((viewerId) => (
                      <div key={viewerId} className="flex items-center justify-between px-3 py-2">
                        <span className="text-text-primary font-medium">
                          {viewerId.toUpperCase()}
                        </span>
                        <button
                          onClick={() => handleRemoveViewer(viewerId)}
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
