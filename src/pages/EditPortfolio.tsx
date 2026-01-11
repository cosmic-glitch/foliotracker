import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TrendingUp, ArrowLeft, Loader2, AlertTriangle, X, Globe, Lock, Users, Plus, Trash2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface LocationState {
  password?: string;
}

interface StaticHoldingPreview {
  ticker: string;
  value: number;
  instrumentType: string;
}

interface ClassificationPreview {
  tradeable: { ticker: string; value: number; name: string }[];
  static: StaticHoldingPreview[];
}

type Visibility = 'public' | 'private' | 'selective';

export function EditPortfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const location = useLocation();
  const password = (location.state as LocationState)?.password;

  const [holdings, setHoldings] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [viewers, setViewers] = useState<string[]>([]);
  const [selectedViewer, setSelectedViewer] = useState('');
  const [allPortfolios, setAllPortfolios] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [preview, setPreview] = useState<ClassificationPreview | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    // If no password in state, redirect back to landing
    if (!password) {
      navigate('/');
      return;
    }

    async function fetchPortfolio() {
      try {
        // Include password to access private portfolios
        const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
        url.searchParams.set('id', portfolioId!);
        if (password) {
          url.searchParams.set('password', password);
        }

        const response = await fetch(url.toString());
        if (!response.ok) throw new Error('Failed to fetch portfolio');

        const data = await response.json();
        setVisibility(data.visibility ?? 'public');
        setViewers(data.viewers ?? []);

        // Convert holdings back to input format
        const holdingsText = data.holdings
          .map((h: { ticker: string; value: number; costBasis: number | null }) => {
            const valueInThousands = h.value / 1000;
            if (h.costBasis !== null) {
              const costBasisInThousands = h.costBasis / 1000;
              return `${h.ticker}: ${valueInThousands.toFixed(1)} @ ${costBasisInThousands.toFixed(1)}`;
            }
            return `${h.ticker}: ${valueInThousands.toFixed(1)}`;
          })
          .join('\n');

        setHoldings(holdingsText);
      } catch (err) {
        console.error('Error fetching portfolio:', err);
        setError('Could not load portfolio');
      } finally {
        setIsLoading(false);
      }
    }

    fetchPortfolio();
  }, [portfolioId, password, navigate]);

  // Fetch all portfolios for viewer selection
  useEffect(() => {
    async function fetchPortfolios() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/portfolios`);
        if (response.ok) {
          const data = await response.json();
          const ids = data.portfolios.map((p: { id: string }) => p.id.toLowerCase());
          setAllPortfolios(ids);
        }
      } catch (err) {
        console.error('Failed to fetch portfolios:', err);
      }
    }
    fetchPortfolios();
  }, []);

  // Get available portfolios (exclude the one being edited and already added viewers)
  const availablePortfolios = allPortfolios.filter(
    (id) => id !== portfolioId?.toLowerCase() && !viewers.includes(id)
  );

  const handleAddViewer = () => {
    if (!selectedViewer) return;
    if (viewers.includes(selectedViewer)) return;
    setViewers([...viewers, selectedViewer]);
    setSelectedViewer('');
  };

  const handleRemoveViewer = (viewerId: string) => {
    setViewers(viewers.filter((v) => v !== viewerId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // First, get a preview of how holdings will be classified
      const previewResponse = await fetch(`${API_BASE_URL}/api/portfolios?preview=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: portfolioId, password, holdings }),
      });

      const previewData = await previewResponse.json();

      if (!previewResponse.ok) {
        throw new Error(previewData.error || 'Failed to analyze holdings');
      }

      // If there are static holdings, show confirmation modal
      if (previewData.static.length > 0) {
        setPreview(previewData);
        setShowConfirmation(true);
        setIsSubmitting(false);
        return;
      }

      // No static holdings, proceed directly
      await savePortfolio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSubmitting(false);
    }
  };

  const savePortfolio = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: portfolioId,
          password,
          holdings,
          visibility,
          viewers: visibility === 'selective' ? viewers : [],
          ...(newPassword && { newPassword }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update portfolio');
      }

      // Invalidate caches so data recalculates with new holdings
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });

      // Redirect to the portfolio view
      navigate(`/${portfolioId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setShowConfirmation(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = () => {
    savePortfolio();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: portfolioId, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete portfolio');
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });

      // Redirect to landing page
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setShowDeleteConfirmation(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatValue = (value: number) => {
    return `$${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="p-2 hover:bg-card rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-text-secondary" />
            </Link>
            <div className="p-2 bg-accent/10 rounded-lg">
              <TrendingUp className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-xl font-semibold text-text-primary">
              Edit Portfolio
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm">
              {error}
            </div>
          )}

          {/* Portfolio Info */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-sm text-text-secondary mb-1">Portfolio</p>
            <p className="font-medium text-text-primary">{portfolioId?.toUpperCase()}</p>
          </div>

          {/* Change Password */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              New Password (optional)
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Leave blank to keep current password"
              minLength={4}
            />
            <p className="text-xs text-text-secondary mt-2">
              Enter a new password (minimum 4 characters) to change your portfolio password.
            </p>
          </div>

          {/* Holdings */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Holdings
            </label>
            <textarea
              value={holdings}
              onChange={(e) => setHoldings(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent font-mono text-sm"
              rows={12}
              required
            />
            <p className="text-xs text-text-secondary mt-2">
              Enter each holding on a new line: TICKER: VALUE
              <br />
              Optional cost basis: TICKER: VALUE @ COST_BASIS (e.g., NVDA: 100 @ 80)
              <br />
              All values in thousands USD. Non-tradeable assets (like "Real Estate") will be treated as static values.
            </p>
          </div>

          {/* Visibility */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
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

            {/* Viewers List (only for selective) */}
            {visibility === 'selective' && (
              <div className="mt-4 space-y-3">
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
                    type="button"
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
                          type="button"
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
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <Link
              to="/"
              className="flex-1 bg-background hover:bg-card-hover border border-border text-text-primary font-medium py-3 px-4 rounded-xl transition-colors text-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>

          {/* Delete Portfolio */}
          <div className="bg-card rounded-xl border border-negative/30 p-4 mt-8">
            <h3 className="text-sm font-medium text-negative mb-2">Danger Zone</h3>
            <p className="text-xs text-text-secondary mb-4">
              Once you delete a portfolio, there is no going back. Please be certain.
            </p>
            <button
              type="button"
              onClick={() => setShowDeleteConfirmation(true)}
              className="w-full bg-negative/10 hover:bg-negative/20 border border-negative/30 text-negative font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Portfolio
            </button>
          </div>
        </form>
      </main>

      {/* Static Holdings Confirmation Modal */}
      {showConfirmation && preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Confirm Static Holdings
                </h3>
              </div>
              <button
                onClick={() => setShowConfirmation(false)}
                className="p-1 hover:bg-card-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <p className="text-sm text-text-secondary mb-4">
              The following holdings could not be found in the market and will be treated as fixed values (no automatic price updates):
            </p>

            <div className="bg-background rounded-lg border border-border divide-y divide-border mb-6">
              {preview.static.map((h) => (
                <div key={h.ticker} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-text-primary font-medium">{h.ticker}</span>
                    <span className="text-text-secondary text-xs ml-2">({h.instrumentType})</span>
                  </div>
                  <span className="text-text-secondary">{formatValue(h.value)}</span>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmation(false)}
                className="flex-1 bg-card-hover hover:bg-border text-text-primary font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="flex-1 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Confirm & Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl border border-border max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-negative/10 rounded-lg">
                  <Trash2 className="w-5 h-5 text-negative" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Delete Portfolio
                </h3>
              </div>
              <button
                onClick={() => setShowDeleteConfirmation(false)}
                className="p-1 hover:bg-card-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to delete <span className="font-semibold text-text-primary">{portfolioId?.toUpperCase()}</span>? This action cannot be undone and all portfolio data will be permanently removed.
            </p>

            {error && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirmation(false)}
                className="flex-1 bg-card-hover hover:bg-border text-text-primary font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 bg-negative hover:bg-negative/90 disabled:bg-negative/50 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Portfolio'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
