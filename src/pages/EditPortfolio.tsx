import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TrendingUp, ArrowLeft, Loader2, Globe, Lock, Users, Plus, Trash2, AlertCircle, X } from 'lucide-react';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import type { TradeableHoldingInput, StaticHoldingInput, HoldingsInput } from '../types/portfolio';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface LocationState {
  password?: string;
}

interface TradeablePreview {
  ticker: string;
  shares: number;
  name: string;
  instrumentType: string;
  currentPrice: number;
  currentValue: number;
  costBasis: number | null;
  unrealizedGain: number | null;
  unrealizedGainPercent: number | null;
}

interface StaticPreview {
  name: string;
  value: number;
  instrumentType: string;
}

interface PreviewResponse {
  preview: true;
  tradeable: TradeablePreview[];
  static: StaticPreview[];
  errors?: string[];
}

type Visibility = 'public' | 'private' | 'selective';

export function EditPortfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const location = useLocation();
  const password = (location.state as LocationState)?.password;
  const { logout } = useLoggedInPortfolio();

  const [tradeableHoldings, setTradeableHoldings] = useState<TradeableHoldingInput[]>([
    { ticker: '', shares: 0 }
  ]);
  const [staticHoldings, setStaticHoldings] = useState<StaticHoldingInput[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [viewers, setViewers] = useState<string[]>([]);
  const [selectedViewer, setSelectedViewer] = useState('');
  const [allPortfolios, setAllPortfolios] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!password) {
      navigate('/');
      return;
    }

    async function fetchPortfolio() {
      try {
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

        // Convert holdings to structured format
        const tradeable: TradeableHoldingInput[] = [];
        const staticH: StaticHoldingInput[] = [];

        for (const h of data.holdings) {
          if (h.isStatic) {
            staticH.push({
              name: h.ticker,
              value: h.value,
            });
          } else {
            const costBasisPerShare = h.costBasis && h.shares > 0
              ? h.costBasis / h.shares
              : undefined;
            tradeable.push({
              ticker: h.ticker,
              shares: h.shares,
              costBasisPerShare,
            });
          }
        }

        setTradeableHoldings(tradeable.length > 0 ? tradeable : [{ ticker: '', shares: 0 }]);
        setStaticHoldings(staticH);
      } catch (err) {
        console.error('Error fetching portfolio:', err);
        setError('Could not load portfolio');
      } finally {
        setIsLoading(false);
      }
    }

    fetchPortfolio();
  }, [portfolioId, password, navigate]);

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

  // Tradeable holdings handlers
  const addTradeableRow = () => {
    setTradeableHoldings([...tradeableHoldings, { ticker: '', shares: 0 }]);
  };

  const removeTradeableRow = (index: number) => {
    if (tradeableHoldings.length <= 1) return;
    setTradeableHoldings(tradeableHoldings.filter((_, i) => i !== index));
  };

  const updateTradeableRow = (index: number, field: keyof TradeableHoldingInput, value: string | number) => {
    const updated = [...tradeableHoldings];
    if (field === 'ticker') {
      updated[index] = { ...updated[index], ticker: (value as string).toUpperCase() };
    } else if (field === 'shares') {
      updated[index] = { ...updated[index], shares: Number(value) || 0 };
    } else if (field === 'costBasisPerShare') {
      const numValue = Number(value);
      updated[index] = { ...updated[index], costBasisPerShare: numValue > 0 ? numValue : undefined };
    }
    setTradeableHoldings(updated);
  };

  // Static holdings handlers
  const addStaticRow = () => {
    setStaticHoldings([...staticHoldings, { name: '', value: 0 }]);
  };

  const removeStaticRow = (index: number) => {
    setStaticHoldings(staticHoldings.filter((_, i) => i !== index));
  };

  const updateStaticRow = (index: number, field: keyof StaticHoldingInput, value: string | number) => {
    const updated = [...staticHoldings];
    if (field === 'name') {
      updated[index] = { ...updated[index], name: value as string };
    } else if (field === 'value') {
      updated[index] = { ...updated[index], value: Number(value) || 0 };
    }
    setStaticHoldings(updated);
  };

  const buildHoldingsInput = (): HoldingsInput => {
    return {
      tradeable: tradeableHoldings.filter(h => h.ticker.trim() && h.shares > 0),
      static: staticHoldings.filter(h => h.name.trim() && h.value > 0),
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const holdingsInput = buildHoldingsInput();

    if (holdingsInput.tradeable.length === 0 && holdingsInput.static.length === 0) {
      setError('At least one holding is required');
      setIsSubmitting(false);
      return;
    }

    try {
      const previewResponse = await fetch(`${API_BASE_URL}/api/portfolios?preview=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: portfolioId, password, holdings: holdingsInput }),
      });

      const previewData = await previewResponse.json();

      if (!previewResponse.ok) {
        throw new Error(previewData.error || 'Failed to analyze holdings');
      }

      if (previewData.errors && previewData.errors.length > 0) {
        setError(previewData.errors.join('\n'));
        setIsSubmitting(false);
        return;
      }

      setPreview(previewData);
      setShowPreview(true);
      setIsSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSubmitting(false);
    }
  };

  const savePortfolio = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const holdingsInput = buildHoldingsInput();
      const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: portfolioId,
          password,
          holdings: holdingsInput,
          visibility,
          viewers: visibility === 'selective' ? viewers : [],
          ...(newPassword && { newPassword }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update portfolio');
      }

      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      navigate(`/${portfolioId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setShowPreview(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);

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

      await queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      await queryClient.invalidateQueries({ queryKey: ['portfolios'] });

      logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsDeleting(false);
    }
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
            <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm whitespace-pre-line">
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

          {/* Tradeable Holdings */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-text-primary">
                Tradeable Holdings
              </label>
              <button
                type="button"
                onClick={addTradeableRow}
                className="flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Row
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              Stocks, ETFs, and mutual funds. Enter number of shares and optional cost basis per share.
            </p>

            <div className="space-y-3">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 text-xs text-text-secondary font-medium">
                <div className="col-span-4">Ticker</div>
                <div className="col-span-3">Shares</div>
                <div className="col-span-4">Cost/Share</div>
                <div className="col-span-1"></div>
              </div>

              {tradeableHoldings.map((holding, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={holding.ticker}
                    onChange={(e) => updateTradeableRow(index, 'ticker', e.target.value)}
                    placeholder="VUG"
                    className="col-span-4 bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                  />
                  <input
                    type="number"
                    value={holding.shares || ''}
                    onChange={(e) => updateTradeableRow(index, 'shares', e.target.value)}
                    placeholder="100"
                    min="0"
                    step="any"
                    className="col-span-3 bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                  />
                  <div className="col-span-4 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                    <input
                      type="number"
                      value={holding.costBasisPerShare ?? ''}
                      onChange={(e) => updateTradeableRow(index, 'costBasisPerShare', e.target.value)}
                      placeholder="Optional"
                      min="0"
                      step="any"
                      className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTradeableRow(index)}
                    disabled={tradeableHoldings.length <= 1}
                    className="col-span-1 p-2 hover:bg-negative/10 hover:text-negative rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Static Holdings */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-text-primary">
                Static Holdings
              </label>
              <button
                type="button"
                onClick={addStaticRow}
                className="flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Row
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              Non-market assets like cash, real estate, or crypto. Enter a fixed dollar value.
            </p>

            {staticHoldings.length === 0 ? (
              <div className="text-sm text-text-secondary text-center py-4 bg-background rounded-lg border border-border">
                No static holdings. Click "Add Row" to add cash, real estate, etc.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 text-xs text-text-secondary font-medium">
                  <div className="col-span-6">Name</div>
                  <div className="col-span-5">Value ($)</div>
                  <div className="col-span-1"></div>
                </div>

                {staticHoldings.map((holding, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      value={holding.name}
                      onChange={(e) => updateStaticRow(index, 'name', e.target.value)}
                      placeholder="Real Estate"
                      className="col-span-6 bg-background border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                    />
                    <div className="col-span-5 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                      <input
                        type="number"
                        value={holding.value || ''}
                        onChange={(e) => updateStaticRow(index, 'value', e.target.value)}
                        placeholder="100000"
                        min="0"
                        step="any"
                        className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStaticRow(index)}
                      className="col-span-1 p-2 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                  Validating...
                </>
              ) : (
                'Preview & Save'
              )}
            </button>
          </div>

          {/* Delete Portfolio */}
          <div className="pt-6 border-t border-border">
            <button
              type="button"
              onClick={() => setShowDeleteConfirmation(true)}
              className="w-full bg-negative/10 hover:bg-negative/20 border border-negative/30 text-negative font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-5 h-5" />
              Delete Portfolio
            </button>
          </div>
        </form>
      </main>

      {/* Preview Modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-card rounded-2xl border border-border max-w-2xl w-full p-6 my-8">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                Preview Holdings
              </h3>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1 hover:bg-card-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            {/* Tradeable Holdings Preview */}
            {preview.tradeable.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-text-primary mb-3">Tradeable Holdings</h4>
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-text-secondary font-medium">Ticker</th>
                        <th className="text-right px-3 py-2 text-text-secondary font-medium">Shares</th>
                        <th className="text-right px-3 py-2 text-text-secondary font-medium">Price</th>
                        <th className="text-right px-3 py-2 text-text-secondary font-medium">Value</th>
                        <th className="text-right px-3 py-2 text-text-secondary font-medium">Gain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.tradeable.map((h) => (
                        <tr key={h.ticker} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">
                            <div className="font-medium text-text-primary">{h.ticker}</div>
                            <div className="text-xs text-text-secondary">{h.name}</div>
                          </td>
                          <td className="text-right px-3 py-2 text-text-primary">{h.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                          <td className="text-right px-3 py-2 text-text-secondary">{formatCurrency(h.currentPrice)}</td>
                          <td className="text-right px-3 py-2 text-text-primary font-medium">{formatCurrency(h.currentValue)}</td>
                          <td className="text-right px-3 py-2">
                            {h.unrealizedGain !== null ? (
                              <div className={h.unrealizedGain >= 0 ? 'text-positive' : 'text-negative'}>
                                {formatCurrency(h.unrealizedGain)}
                                <div className="text-xs">{formatPercent(h.unrealizedGainPercent!)}</div>
                              </div>
                            ) : (
                              <span className="text-text-secondary">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Static Holdings Preview */}
            {preview.static.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-text-primary mb-3">Static Holdings</h4>
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-text-secondary font-medium">Name</th>
                        <th className="text-left px-3 py-2 text-text-secondary font-medium">Type</th>
                        <th className="text-right px-3 py-2 text-text-secondary font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.static.map((h) => (
                        <tr key={h.name} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-medium text-text-primary">{h.name}</td>
                          <td className="px-3 py-2 text-text-secondary">{h.instrumentType}</td>
                          <td className="text-right px-3 py-2 text-text-primary font-medium">{formatCurrency(h.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowPreview(false)}
                className="flex-1 bg-card-hover hover:bg-border text-text-primary font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={savePortfolio}
                disabled={isSubmitting}
                className="flex-1 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
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
                  <AlertCircle className="w-5 h-5 text-negative" />
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
              Are you sure you want to delete <span className="font-semibold text-text-primary">{portfolioId?.toUpperCase()}</span>? This action cannot be undone. All holdings and data will be permanently removed.
            </p>

            {deleteError && (
              <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
                {deleteError}
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
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
