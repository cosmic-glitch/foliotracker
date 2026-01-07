import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { TrendingUp, ArrowLeft, Loader2, AlertTriangle, X } from 'lucide-react';

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

export function EditPortfolio() {
  const navigate = useNavigate();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const location = useLocation();
  const password = (location.state as LocationState)?.password;

  const [holdings, setHoldings] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [preview, setPreview] = useState<ClassificationPreview | null>(null);

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
        setDisplayName(data.displayName || '');
        setIsPrivate(data.isPrivate ?? false);

        // Convert holdings back to input format
        const holdingsText = data.holdings
          .map((h: { ticker: string; value: number }) => {
            const valueInThousands = h.value / 1000;
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
          isPrivate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update portfolio');
      }

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
            <p className="text-sm text-text-secondary mb-1">Portfolio ID</p>
            <p className="font-medium text-text-primary">{portfolioId}</p>
            {displayName && (
              <>
                <p className="text-sm text-text-secondary mt-3 mb-1">
                  Display Name
                </p>
                <p className="font-medium text-text-primary">{displayName}</p>
              </>
            )}
          </div>

          {/* Private Toggle */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-text-primary">
                  Private Portfolio
                </label>
                <p className="text-xs text-text-secondary mt-1">
                  Hide portfolio values on the homepage. Password required to view details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPrivate(!isPrivate)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  isPrivate ? 'bg-accent' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    isPrivate ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
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
              Enter each holding on a new line: TICKER: VALUE (in thousands USD)
              <br />
              Non-tradeable assets (like "Real Estate") will be treated as
              static values.
            </p>
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
    </div>
  );
}
