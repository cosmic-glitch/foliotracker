import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Plus, Users, Pencil, Trash2, Lock } from 'lucide-react';
import { PasswordModal } from '../components/PasswordModal';
import { isMarketOpen } from '../lib/market-hours';

interface Portfolio {
  id: string;
  display_name: string | null;
  created_at: string;
  totalValue: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  is_private: boolean;
}

interface PortfoliosResponse {
  portfolios: Portfolio[];
  count: number;
  maxPortfolios: number;
  canCreate: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

async function fetchPortfolios(): Promise<PortfoliosResponse> {
  const response = await fetch(`${API_BASE_URL}/api/portfolios`, { cache: 'default' });
  if (!response.ok) throw new Error('Failed to fetch portfolios');
  return response.json();
}

function formatCompactValue(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(0)}`;
}

export function LandingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Portfolio | null>(null);
  const [editTarget, setEditTarget] = useState<Portfolio | null>(null);

  // Use TanStack Query for auto-refresh
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolios'],
    queryFn: fetchPortfolios,
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchInterval: () => isMarketOpen() ? 5 * 60 * 1000 : 30 * 60 * 1000,
  });

  const handleDelete = async (password: string) => {
    if (!deleteTarget) return;

    const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id, password }),
    });

    if (!response.ok) {
      const json = await response.json();
      throw new Error(json.error || 'Failed to delete portfolio');
    }

    // Invalidate cache to refetch updated list
    queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    setDeleteTarget(null);
  };

  const handleEditVerify = async (password: string) => {
    if (!editTarget) return;

    // Verify password via PUT with empty update (will fail validation but after password check)
    // Or we can add a verify-only endpoint. For now, navigate to edit page with password in state.
    const response = await fetch(`${API_BASE_URL}/api/portfolios`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editTarget.id, password, holdings: '' }),
    });

    // If password is wrong, we'll get 401. If password is right, we'll get 400 (empty holdings).
    if (response.status === 401) {
      throw new Error('Invalid password');
    }

    // Password verified, navigate to edit page
    navigate(`/${editTarget.id}/edit`, { state: { password } });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <TrendingUp className="w-6 h-6 text-accent" />
            </div>
            <h1 className="text-xl font-semibold text-text-primary">
              Portfolio Tracker
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-accent text-sm mb-6">
            {error.message || 'Could not load portfolios'}
          </div>
        )}

        {/* Portfolios List */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Users className="w-5 h-5 text-text-secondary" />
            <h3 className="text-lg font-semibold text-text-primary">
              Portfolios
            </h3>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-text-secondary">
              Loading portfolios...
            </div>
          ) : data?.portfolios.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">
              No portfolios yet. Be the first to create one!
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data?.portfolios.map((portfolio) => {
                const isPrivate = portfolio.is_private && portfolio.totalValue === null;
                const isPositive = (portfolio.dayChange ?? 0) >= 0;
                const changeColor = isPositive ? 'text-positive' : 'text-negative';
                const sign = isPositive ? '+' : '';

                return (
                  <div
                    key={portfolio.id}
                    className="flex items-center justify-between p-4 hover:bg-card-hover transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary flex items-center gap-2">
                        {portfolio.display_name || portfolio.id}
                        {portfolio.is_private && (
                          <>
                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full">
                              Private
                            </span>
                          </>
                        )}
                      </p>
                      {isPrivate ? (
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-lg font-semibold text-text-primary blur-sm select-none">
                            $X,XXX,XXX
                          </span>
                          <span className="text-sm text-positive blur-sm select-none">
                            +$X.Xk (+X.XX%)
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-lg font-semibold text-text-primary">
                            ${(portfolio.totalValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                          <span className={`text-sm ${changeColor}`}>
                            {sign}{formatCompactValue(Math.abs(portfolio.dayChange ?? 0))} ({sign}{(portfolio.dayChangePercent ?? 0).toFixed(2)}%)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/${portfolio.id}`}
                        className="text-accent hover:text-accent/80 px-3 py-1.5 rounded-lg hover:bg-accent/10 transition-colors"
                      >
                        View →
                      </Link>
                      <button
                        onClick={() => setEditTarget(portfolio)}
                        className="p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
                        title="Edit portfolio"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(portfolio)}
                        className="p-1.5 text-text-secondary hover:text-negative hover:bg-negative/10 rounded-lg transition-colors"
                        title="Delete portfolio"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Button */}
        {data?.canCreate && (
          <Link
            to="/create"
            className="flex items-center justify-center gap-2 w-full bg-accent hover:bg-accent/90 text-white font-medium py-3 px-4 rounded-xl transition-colors mt-6"
          >
            <Plus className="w-5 h-5" />
            Create New Portfolio
          </Link>
        )}
      </main>

      {/* Delete Modal */}
      {deleteTarget && (
        <PasswordModal
          title="Delete Portfolio"
          description={`Are you sure you want to delete "${deleteTarget.display_name || deleteTarget.id}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Edit Modal */}
      {editTarget && (
        <PasswordModal
          title="Edit Portfolio"
          description={`Enter the password to edit "${editTarget.display_name || editTarget.id}".`}
          confirmLabel="Continue"
          onConfirm={handleEditVerify}
          onCancel={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
