import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Plus, Users, Lock, LogIn, LogOut, Eye, Globe, UserPlus, Briefcase, Shield, Sparkles } from 'lucide-react';
import { SignInModal } from '../components/SignInModal';
import { PermissionsModal } from '../components/PermissionsModal';
import { MarketStatusBadge } from '../components/MarketStatusBadge';
import { UserMenu } from '../components/UserMenu';
import { isLiveMarketSession, getMarketStatus } from '../lib/market-hours';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { useExtendedHours } from '../context/ExtendedHoursContext';
import { usePeakReveal } from '../hooks/usePeakReveal';
import { Footer } from '../components/Footer';
import { loginToPortfolio } from '../lib/auth';
import { formatChange } from '../utils/formatters';

interface Portfolio {
  id: string;
  display_name: string | null;
  created_at: string;
  totalValue: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  regularTotalValue: number | null;
  regularDayChange: number | null;
  regularDayChangePercent: number | null;
  peakPotentialValue: number | null;
  // 30D change against the oldest stored history point (~30 trading days back).
  // null when no anchor exists (brand-new portfolio) or — for the
  // dollar-denominated pair — when the viewer is allocation-only restricted.
  thirtyDayChange: number | null;
  thirtyDayChangePercent: number | null;
  regularThirtyDayChange: number | null;
  regularThirtyDayChangePercent: number | null;
  thirtyDayWindowStart: string | null;
  is_private: boolean;
  visibility: 'public' | 'private' | 'selective';
  // When TRUE, restricted viewers still receive day-change % (no $ total).
  // The LP row uses this to pick the "Allocation only" render instead of blur.
  allocation_public: boolean;
  lastUpdated?: string;
}

type Timeframe = 'day' | '30d';
const TIMEFRAME_STORAGE_KEY = 'landingTimeframe';

function loadInitialTimeframe(): Timeframe {
  if (typeof window === 'undefined') return 'day';
  const stored = window.localStorage.getItem(TIMEFRAME_STORAGE_KEY);
  if (stored === 'day' || stored === '30d') return stored;
  // Default: 1D when the market is live (intraday context matters), 30D
  // otherwise (1D is stale anyway when the market is closed).
  return isLiveMarketSession() ? 'day' : '30d';
}

interface PortfoliosResponse {
  portfolios: Portfolio[];
  count: number;
  maxPortfolios: number;
  canCreate: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

async function fetchPortfolios(loggedInAs: string | null): Promise<PortfoliosResponse> {
  const url = new URL(`${API_BASE_URL}/api/portfolios`, window.location.origin);
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }
  const response = await fetch(url.toString(), { cache: 'no-store' });
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

interface PortfolioListRowProps {
  portfolio: Portfolio;
  displayValue: number;
  // null when the chosen timeframe has no data (e.g., brand-new portfolio in
  // 30D mode). Renders as "—" instead of a misleading "+$0.00 (+0.00%)".
  displayChange: number | null;
  displayChangePercent: number | null;
  peakPotentialValue: number;
  shouldBlurValues: boolean;
  // When true, the row is restricted but allocation_public is ON: show
  // day-change % instead of a blurred dollar total.
  restrictedAllocOnly: boolean;
}

function PortfolioListRow({
  portfolio,
  displayValue,
  displayChange,
  displayChangePercent,
  peakPotentialValue,
  shouldBlurValues,
  restrictedAllocOnly,
}: PortfolioListRowProps) {
  const { animatedValue, isRevealing, peakDelta, triggerReveal, onKeyDown } = usePeakReveal(
    displayValue,
    peakPotentialValue,
  );
  const hasChange = displayChange !== null && displayChangePercent !== null;
  const isPositive = hasChange && displayChange! >= 0;
  const changeColor = isPositive ? 'text-positive' : 'text-negative';
  const sign = isPositive ? '+' : '';
  const canReveal = !shouldBlurValues && peakPotentialValue > displayValue;

  return (
    <div className="flex items-center gap-3 px-4 py-2 sm:py-3 hover:bg-card-hover transition-colors">
      {/* Left: Username + visibility tag */}
      <div className="min-w-0 shrink-0">
        <p className="font-medium text-text-primary">
          {portfolio.id.toUpperCase()}
        </p>
        {portfolio.visibility === 'public' && (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full mt-0.5">
            <Globe className="w-3 h-3" />
            Public
          </span>
        )}
        {portfolio.visibility === 'private' && (
          <span className="inline-flex items-center gap-1 text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full mt-0.5">
            <Lock className="w-3 h-3" />
            Private
          </span>
        )}
        {portfolio.visibility === 'selective' && (
          <span className="inline-flex items-center gap-1 text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded-full mt-0.5">
            <Users className="w-3 h-3" />
            By Invite
          </span>
        )}
      </div>

      {/* Middle: Value + day change (tap-to-reveal peak on non-blurred rows) */}
      <div className="flex-1 min-w-0 text-right">
        {shouldBlurValues ? (
          <div>
            <span className="text-lg font-semibold text-text-primary blur-sm select-none">
              $X,XXX,XXX
            </span>
            <p className="text-sm text-positive blur-sm select-none">
              +$X.Xk (+X.XX%)
            </p>
          </div>
        ) : restrictedAllocOnly ? (
          // No owner-level access, but the owner has allocation_public ON.
          // Drop the dollar metaphor: a muted "Value hidden" lock cue above
          // the day-change % (the only figure this viewer is allowed to see).
          <div>
            <span className="flex items-center justify-end gap-1.5 text-sm text-text-secondary">
              <Lock className="w-3.5 h-3.5" />
              Value hidden
            </span>
            {displayChangePercent !== null ? (
              <p className={`text-sm ${displayChangePercent >= 0 ? 'text-positive' : 'text-negative'}`}>
                {displayChangePercent >= 0 ? '+' : ''}{displayChangePercent.toFixed(2)}%
              </p>
            ) : (
              <p className="text-sm text-text-secondary">—</p>
            )}
          </div>
        ) : (
          <div
            className={canReveal ? 'cursor-pointer select-none' : ''}
            onClick={canReveal ? triggerReveal : undefined}
            role={canReveal ? 'button' : undefined}
            tabIndex={canReveal ? 0 : undefined}
            onKeyDown={canReveal ? onKeyDown : undefined}
          >
            <span className="text-lg font-semibold text-text-primary">
              ${animatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            {!isRevealing ? (
              hasChange ? (
                <p className={`text-sm ${changeColor}`}>
                  {sign}{formatCompactValue(Math.abs(displayChange!))} ({sign}{displayChangePercent!.toFixed(2)}%)
                </p>
              ) : (
                <p className="text-sm text-text-secondary">—</p>
              )
            ) : (
              <p className="text-sm text-amber-400 flex items-center justify-end gap-1 animate-[fadeIn_0.2s_ease-out] whitespace-nowrap">
                <Sparkles className="w-3 h-3" />
                {formatChange(peakDelta, true)} at 52w high
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right: View button. Always "View" — restricted viewers land on the
          allocation-only detail page (with a notice up top) when
          allocation_public is on, or hit the password prompt when it's off. */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <Link
          to={`/${portfolio.id}`}
          className="flex items-center gap-1.5 text-accent hover:text-accent/80 px-2.5 py-1.5 rounded-lg hover:bg-accent/10 transition-colors text-sm"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </Link>
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const { loggedInAs, login, logout, getToken } = useLoggedInPortfolio();
  const { showExtendedHours } = useExtendedHours();
  const [showSignIn, setShowSignIn] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  // Which timeframe drives the change column (1D vs 30D). Sticky via
  // localStorage; first-load default depends on whether the market is live.
  const [timeframe, setTimeframe] = useState<Timeframe>(loadInitialTimeframe);

  useEffect(() => {
    window.localStorage.setItem(TIMEFRAME_STORAGE_KEY, timeframe);
  }, [timeframe]);

  // Use TanStack Query for auto-refresh
  const { data, isLoading, error, refetch: refetchPortfolios } = useQuery({
    queryKey: ['portfolios', loggedInAs],
    queryFn: () => fetchPortfolios(loggedInAs),
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchInterval: () => isLiveMarketSession() ? 60 * 1000 : 30 * 60 * 1000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  useEffect(() => {
    const handleTabVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refetchPortfolios();
    };

    window.addEventListener('focus', handleTabVisible);
    document.addEventListener('visibilitychange', handleTabVisible);

    return () => {
      window.removeEventListener('focus', handleTabVisible);
      document.removeEventListener('visibilitychange', handleTabVisible);
    };
  }, [refetchPortfolios]);

  const portfolios = useMemo(() => data?.portfolios ?? [], [data]);

  // Get most recent lastUpdated from all portfolios
  const latestUpdate = useMemo(() => {
    if (portfolios.length === 0) return null;
    return portfolios.reduce((latest, p) => {
      if (!p.lastUpdated) return latest;
      const pDate = new Date(p.lastUpdated);
      return !latest || pDate > latest ? pDate : latest;
    }, null as Date | null);
  }, [portfolios]);

  const handleSignIn = async (userId: string, password: string) => {
    // Verify credentials via login endpoint — get token back
    const result = await loginToPortfolio(userId, password);

    // Token received, log in (use the canonical id the server returns)
    login(result.portfolioId, result.token, result.expiresAt);
    setShowSignIn(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-2 md:py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="p-2 bg-accent/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <h1 className="text-xl font-semibold text-text-primary whitespace-nowrap">
                FolioTracker
              </h1>
            </button>
            <div className="flex items-center gap-1.5 md:gap-3">
              {loggedInAs && (
                <UserMenu
                  loggedInAs={loggedInAs}
                  onEdit={() => navigate(`/${loggedInAs}/edit`, { state: { token: getToken() } })}
                  onPermissions={() => setShowPermissions(true)}
                  onLogout={logout}
                  showEditAndPermissions
                />
              )}
              <MarketStatusBadge status={getMarketStatus()} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-3 md:py-8">
        {error && (
          <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-accent text-sm mb-6">
            {error.message || 'Could not load portfolios'}
          </div>
        )}

        <div className="md:flex md:gap-6">
          {/* Left column: Users table + Create button */}
          <div className="md:flex-1 min-w-0">
            {/* Portfolios List */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-5 h-5 text-text-secondary shrink-0" />
                  <h3 className="text-lg font-semibold text-text-primary">
                    Users
                  </h3>
                </div>
                {/* 1D / 30D segmented toggle: swaps the change column without
                    changing row density. Sticky per browser. */}
                <div
                  role="tablist"
                  aria-label="Change timeframe"
                  className="inline-flex items-center bg-background rounded-lg p-0.5 border border-border text-xs shrink-0"
                >
                  <button
                    role="tab"
                    aria-selected={timeframe === 'day'}
                    onClick={() => setTimeframe('day')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      timeframe === 'day'
                        ? 'bg-card-hover text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    1D
                  </button>
                  <button
                    role="tab"
                    aria-selected={timeframe === '30d'}
                    onClick={() => setTimeframe('30d')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      timeframe === '30d'
                        ? 'bg-card-hover text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    30D
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-text-secondary">
                  Loading portfolios...
                </div>
              ) : portfolios.length === 0 ? (
                <div className="p-8 text-center text-text-secondary">
                  No portfolios yet. Be the first to create one!
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {portfolios.map((portfolio) => {
                    // Restricted = visibility !== public AND server omitted
                    // the dollar total. Owner-side: server returned full
                    // values, so isRestricted stays false.
                    const isRestricted =
                      portfolio.visibility !== 'public' && portfolio.totalValue === null;
                    const restrictedAllocOnly = isRestricted && portfolio.allocation_public;
                    const shouldBlurValues = isRestricted && !portfolio.allocation_public;
                    const displayValue = showExtendedHours
                      ? (portfolio.totalValue ?? 0)
                      : (portfolio.regularTotalValue ?? portfolio.totalValue ?? 0);
                    // Resolve change values from the active timeframe. Each
                    // pair has an extended-hours flavor and a regular-session
                    // flavor; respect the same showExtendedHours rule as the
                    // dollar total above. Nulls flow through so the row
                    // renders "—" when 30D has no anchor yet.
                    const displayChange =
                      timeframe === '30d'
                        ? (showExtendedHours
                            ? portfolio.thirtyDayChange
                            : portfolio.regularThirtyDayChange ?? portfolio.thirtyDayChange)
                        : (showExtendedHours
                            ? (portfolio.dayChange ?? 0)
                            : (portfolio.regularDayChange ?? portfolio.dayChange ?? 0));
                    const displayChangePercent =
                      timeframe === '30d'
                        ? (showExtendedHours
                            ? portfolio.thirtyDayChangePercent
                            : portfolio.regularThirtyDayChangePercent ?? portfolio.thirtyDayChangePercent)
                        : (showExtendedHours
                            ? (portfolio.dayChangePercent ?? 0)
                            : (portfolio.regularDayChangePercent ?? portfolio.dayChangePercent ?? 0));
                    const peakPotentialValue = Math.max(
                      portfolio.peakPotentialValue ?? 0,
                      displayValue,
                    );

                    return (
                      <PortfolioListRow
                        key={portfolio.id}
                        portfolio={portfolio}
                        displayValue={displayValue}
                        displayChange={displayChange}
                        displayChangePercent={displayChangePercent}
                        peakPotentialValue={peakPotentialValue}
                        shouldBlurValues={shouldBlurValues}
                        restrictedAllocOnly={restrictedAllocOnly}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Auth actions */}
            {loggedInAs ? (
              <button
                onClick={logout}
                className="flex items-center justify-center gap-2 w-full bg-background hover:bg-card-hover border border-border text-text-primary font-medium py-3 px-4 rounded-xl transition-colors mt-6"
              >
                <LogOut className="w-5 h-5" />
                Log out
              </button>
            ) : (
              <div className="flex gap-3 mt-6">
                {data?.canCreate && (
                  <Link
                    to="/create"
                    className="flex items-center justify-center gap-2 flex-1 bg-background hover:bg-card-hover border border-border text-text-primary font-medium py-3 px-4 rounded-xl transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Sign up
                  </Link>
                )}
                <button
                  onClick={() => setShowSignIn(true)}
                  className="flex items-center justify-center gap-2 flex-1 bg-background hover:bg-card-hover border border-border text-text-primary font-medium py-3 px-4 rounded-xl transition-colors"
                >
                  <LogIn className="w-5 h-5" />
                  Sign in
                </button>
              </div>
            )}
          </div>

          {/* Right column: Intro blurb */}
          <div className="mt-6 md:mt-0 md:w-64 md:shrink-0">
            <p className="text-text-secondary text-sm font-medium mb-3">A privacy-first social portfolio tracker.</p>
            <ul className="text-text-secondary text-sm space-y-4">
              <li className="flex items-start gap-3">
                <UserPlus className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <span>Pick a user ID and password. No email or real name needed.</span>
              </li>
              <li className="flex items-start gap-3">
                <Briefcase className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <span>Enter your current holdings. No transaction history or brokerage link needed.</span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <span>Choose who sees your portfolio: public, private, or invite-only.</span>
              </li>
            </ul>
          </div>
        </div>
      </main>

      {/* Sign In Modal */}
      {showSignIn && (
        <SignInModal
          userIds={portfolios.map((p) => p.id)}
          onConfirm={handleSignIn}
          onCancel={() => setShowSignIn(false)}
        />
      )}

      {/* Permissions Modal */}
      {showPermissions && loggedInAs && (
        <PermissionsModal
          portfolioId={loggedInAs}
          token={getToken() || ''}
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
