import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Plus, Users, Pencil, Lock, LogIn, LogOut, User, Globe, Settings } from 'lucide-react';
import { PasswordModal } from '../components/PasswordModal';
import { PermissionsModal } from '../components/PermissionsModal';
import { MarketStatusBadge } from '../components/MarketStatusBadge';
import { isMarketOpen, getMarketStatus } from '../lib/market-hours';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { Footer } from '../components/Footer';

interface Portfolio {
  id: string;
  display_name: string | null;
  created_at: string;
  totalValue: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  is_private: boolean;
  visibility: 'public' | 'private' | 'selective';
  lastUpdated?: string;
}

interface PortfoliosResponse {
  portfolios: Portfolio[];
  count: number;
  maxPortfolios: number;
  canCreate: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

async function fetchPortfolios(loggedInAs: string | null, intraday = false): Promise<PortfoliosResponse> {
  const url = new URL(`${API_BASE_URL}/api/portfolios`, window.location.origin);
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }
  if (intraday) {
    url.searchParams.set('intraday', 'true');
  }
  const response = await fetch(url.toString(), { cache: intraday ? 'no-store' : 'default' });
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
  const { loggedInAs, login, logout, getPassword } = useLoggedInPortfolio();
  const [loginTarget, setLoginTarget] = useState<Portfolio | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  // Use TanStack Query for auto-refresh
  const { data, isLoading, error, refetch: refetchPortfolios } = useQuery({
    queryKey: ['portfolios', loggedInAs],
    queryFn: () => fetchPortfolios(loggedInAs),
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchInterval: () => isMarketOpen() ? 60 * 1000 : 30 * 60 * 1000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  // Fetch intraday values when market is open for more accurate totals
  const { data: intradayData, refetch: refetchIntraday } = useQuery({
    queryKey: ['portfolios-intraday', loggedInAs],
    queryFn: () => fetchPortfolios(loggedInAs, true),
    enabled: isMarketOpen(),
    staleTime: 0, // Always refetch
    gcTime: 5 * 60 * 1000,
    refetchInterval: () => isMarketOpen() ? 60 * 1000 : false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  useEffect(() => {
    const handleTabVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refetchPortfolios();
      if (isMarketOpen()) {
        void refetchIntraday();
      }
    };

    window.addEventListener('focus', handleTabVisible);
    document.addEventListener('visibilitychange', handleTabVisible);

    return () => {
      window.removeEventListener('focus', handleTabVisible);
      document.removeEventListener('visibilitychange', handleTabVisible);
    };
  }, [refetchPortfolios, refetchIntraday]);

  // Merge intraday values with base data when available
  const getPortfolioValues = (portfolio: Portfolio) => {
    if (isMarketOpen() && intradayData) {
      const intradayPortfolio = intradayData.portfolios.find(p => p.id === portfolio.id);
      if (intradayPortfolio && intradayPortfolio.totalValue !== null) {
        return {
          totalValue: intradayPortfolio.totalValue,
          dayChange: intradayPortfolio.dayChange,
          dayChangePercent: intradayPortfolio.dayChangePercent,
        };
      }
    }
    return {
      totalValue: portfolio.totalValue,
      dayChange: portfolio.dayChange,
      dayChangePercent: portfolio.dayChangePercent,
    };
  };

  // Get most recent lastUpdated from all portfolios
  const latestUpdate = useMemo(() => {
    if (!data?.portfolios.length) return null;
    return data.portfolios.reduce((latest, p) => {
      if (!p.lastUpdated) return latest;
      const pDate = new Date(p.lastUpdated);
      return !latest || pDate > latest ? pDate : latest;
    }, null as Date | null);
  }, [data?.portfolios]);

  const handleLogin = async (password: string) => {
    if (!loginTarget) return;

    // Verify password via the portfolio API
    const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
    url.searchParams.set('id', loginTarget.id);
    url.searchParams.set('password', password);

    const response = await fetch(url.toString());

    if (response.status === 401) {
      throw new Error('Invalid password');
    }
    if (!response.ok) {
      throw new Error('Failed to verify password');
    }

    // Password is valid, log in
    login(loginTarget.id, password);
    setLoginTarget(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="p-2 bg-accent/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <h1 className="text-xl font-semibold text-text-primary">
                Folio Tracker
              </h1>
            </button>
            <div className="flex items-center gap-3">
              {loggedInAs && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 rounded-lg">
                  <User className="w-3.5 h-3.5 text-accent" />
                  <span className="text-sm font-medium text-accent">
                    {loggedInAs.toUpperCase()}
                  </span>
                </div>
              )}
              <MarketStatusBadge status={getMarketStatus()} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8">
          <ul className="text-text-secondary text-sm space-y-1">
            <li>• Pick a user ID — no email or real name needed</li>
            <li>• Enter your current holdings — no transaction history or brokerage connection needed</li>
            <li>• Mark your portfolio as public, private, or invite-only for select friends</li>
          </ul>
        </div>

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
              Users
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
                const values = getPortfolioValues(portfolio);
                const shouldBlurValues = portfolio.visibility !== 'public' && values.totalValue === null;
                const isPositive = (values.dayChange ?? 0) >= 0;
                const changeColor = isPositive ? 'text-positive' : 'text-negative';
                const sign = isPositive ? '+' : '';

                return (
                  <div
                    key={portfolio.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-4 hover:bg-card-hover transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary flex items-center gap-2">
                        {portfolio.id.toUpperCase()}
                        {portfolio.visibility === 'public' && (
                          <span className="flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full">
                            <Globe className="w-3 h-3" />
                            Public
                          </span>
                        )}
                        {portfolio.visibility === 'private' && (
                          <span className="flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full">
                            <Lock className="w-3 h-3" />
                            Private
                          </span>
                        )}
                        {portfolio.visibility === 'selective' && (
                          <span className="flex items-center gap-1.5 text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded-full">
                            <Users className="w-3 h-3" />
                            By Invite
                          </span>
                        )}
                      </p>
                      {shouldBlurValues ? (
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
                            ${(values.totalValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                          <span className={`text-sm ${changeColor}`}>
                            {sign}{formatCompactValue(Math.abs(values.dayChange ?? 0))} ({sign}{(values.dayChangePercent ?? 0).toFixed(2)}%)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(portfolio.visibility === 'public' ||
                        loggedInAs === portfolio.id.toLowerCase() ||
                        (portfolio.visibility === 'selective' && portfolio.totalValue !== null)) && (
                        <Link
                          to={`/${portfolio.id}`}
                          className="text-accent hover:text-accent/80 px-3 py-1.5 rounded-lg hover:bg-accent/10 transition-colors"
                        >
                          View →
                        </Link>
                      )}
                      {loggedInAs === portfolio.id.toLowerCase() && (
                        <>
                          <button
                            onClick={() => navigate(`/${portfolio.id}/edit`, { state: { password: getPassword() } })}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors text-sm"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Edit</span>
                          </button>
                          <button
                            onClick={() => setShowPermissions(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors text-sm"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Permissions</span>
                          </button>
                        </>
                      )}
                      {loggedInAs === portfolio.id.toLowerCase() ? (
                        <button
                          onClick={logout}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-secondary hover:text-negative hover:bg-negative/10 rounded-lg transition-colors text-sm"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Logout</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setLoginTarget(portfolio)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors text-sm"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Login</span>
                        </button>
                      )}
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
            Add Your Portfolio
          </Link>
        )}
      </main>

      {/* Login Modal */}
      {loginTarget && (
        <PasswordModal
          title="Login"
          description={`Enter the password for "${loginTarget.id.toUpperCase()}" to log in.`}
          confirmLabel="Login"
          onConfirm={handleLogin}
          onCancel={() => setLoginTarget(null)}
        />
      )}

      {/* Permissions Modal */}
      {showPermissions && loggedInAs && (
        <PermissionsModal
          portfolioId={loggedInAs}
          password={getPassword() || ''}
          onClose={() => setShowPermissions(false)}
        />
      )}

      {/* Footer */}
      {latestUpdate && (
        <Footer lastUpdated={latestUpdate} />
      )}
    </div>
  );
}
