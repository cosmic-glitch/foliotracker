import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Plus, Users, Lock, LogIn, LogOut, Eye, Globe, UserPlus, Briefcase, Shield, Sparkles, Trophy } from 'lucide-react';
import { SignInModal } from '../components/SignInModal';
import { PermissionsModal } from '../components/PermissionsModal';
import { MarketStatusBadge } from '../components/MarketStatusBadge';
import { MoversStrip, type MarketMover } from '../components/MoversStrip';
import { UpcomingEvents } from '../components/UpcomingEvents';
import { UserMenu } from '../components/UserMenu';
import { isLiveMarketSession, getMarketStatus } from '../lib/market-hours';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { useLandingViewAnalytics } from '../hooks/useAnalytics';
import { useExtendedHours } from '../context/ExtendedHoursContext';
import { useTimeframe, type Timeframe } from '../context/TimeframeContext';
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

interface PortfoliosResponse {
  portfolios: Portfolio[];
  count: number;
  maxPortfolios: number;
  canCreate: boolean;
  // Most-held tickers swinging ≥2% today; empty on quiet days. Two
  // independently-ranked lists, one per price basis — the strip shows `extended`
  // or `regular` depending on the Extended Hours toggle, matching the holdings
  // table and totals.
  movers?: { regular: MarketMover[]; extended: MarketMover[] };
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

// The day-change % a row actually displays, honoring the extended-hours basis
// and the active 1D/30D timeframe. Factored out so the "Top today" leader calc
// and the per-row render below read from one source and can't drift apart.
// Returns null when the active timeframe has no figure yet (e.g. a brand-new
// portfolio in 30D mode) so callers can render "—" / skip it as the leader.
function getDisplayChangePercent(
  p: Portfolio,
  showExtendedHours: boolean,
  timeframe: Timeframe,
): number | null {
  if (timeframe === '30d') {
    return showExtendedHours
      ? p.thirtyDayChangePercent
      : p.regularThirtyDayChangePercent ?? p.thirtyDayChangePercent;
  }
  return showExtendedHours
    ? (p.dayChangePercent ?? 0)
    : (p.regularDayChangePercent ?? p.dayChangePercent ?? 0);
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
  // True for the single row leading the currently-displayed day-change %.
  // Gets the gold trophy pill + a faint amber row tint.
  isTopMover: boolean;
  // Pill text — "Top today" (1D) or "Top 30D" (30D); kept honest with the
  // active timeframe since the leader is computed from that same metric.
  topMoverLabel: string;
}

function PortfolioListRow({
  portfolio,
  displayValue,
  displayChange,
  displayChangePercent,
  peakPotentialValue,
  shouldBlurValues,
  restrictedAllocOnly,
  isTopMover,
  topMoverLabel,
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
    <div
      className={`flex items-center gap-3 px-4 py-2 sm:py-3 transition-colors ${
        // Faint amber wash for the day's leader; deepens on hover so the row
        // keeps its gold identity instead of falling back to the neutral hover.
        isTopMover
          ? 'bg-amber-500/[0.07] hover:bg-amber-500/[0.12]'
          : 'hover:bg-card-hover'
      }`}
    >
      {/* Left: Username + visibility tag */}
      <div className="min-w-0 shrink-0">
        <p className="font-medium text-text-primary flex items-center gap-1.5">
          {portfolio.id.toUpperCase()}
          {/* Day's-leader pill — same shape as the visibility pills below,
              gold-tinted. font-normal resets the name's font-medium. */}
          {isTopMover && (
            <span className="inline-flex items-center gap-1 text-xs font-normal bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full whitespace-nowrap">
              <Trophy className="w-3 h-3" />
              {topMoverLabel}
            </span>
          )}
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
  useLandingViewAnalytics(loggedInAs);
  const { showExtendedHours } = useExtendedHours();
  const [showSignIn, setShowSignIn] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  // Which timeframe drives the change column (1D vs 30D). Toggled from
  // UserMenu's "30-Day View" row; persisted by TimeframeContext.
  const { timeframe } = useTimeframe();

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

  const portfolios = useMemo(() => {
    const raw = data?.portfolios ?? [];
    if (raw.length === 0) return raw;

    // Tier the list so the viewer sees what's most relevant first:
    //   1 = your own portfolio
    //   2 = full access (public, or selective where you're invited; for these
    //       the API returns a real totalValue)
    //   3 = allocation-only (hideDollarsOnly: "Value hidden" + %)
    //   4 = fully blurred (hideAllValues). Empty in production today since
    //       every portfolio has allocation_public=true, but kept for defense.
    // Within a tier, fall back to the API's existing created_at ASC ordering
    // so positions stay stable across visits and don't shuffle on the
    // timeframe toggle or the extended-hours toggle.
    const viewer = loggedInAs?.toLowerCase() ?? null;
    const tierOf = (p: Portfolio): number => {
      if (viewer && p.id.toLowerCase() === viewer) return 1;
      const isRestricted = p.visibility !== 'public' && p.totalValue === null;
      if (!isRestricted) return 2;
      return p.allocation_public ? 3 : 4;
    };

    return [...raw]
      .map((p, idx) => ({ p, idx, tier: tierOf(p) }))
      .sort((a, b) => a.tier - b.tier || a.idx - b.idx)
      .map((e) => e.p);
  }, [data, loggedInAs]);

  // Get most recent lastUpdated from all portfolios
  const latestUpdate = useMemo(() => {
    if (portfolios.length === 0) return null;
    return portfolios.reduce((latest, p) => {
      if (!p.lastUpdated) return latest;
      const pDate = new Date(p.lastUpdated);
      return !latest || pDate > latest ? pDate : latest;
    }, null as Date | null);
  }, [portfolios]);

  // Which row leads the currently-displayed day-change %. "Displayed" is the
  // crux: the metric follows the 1D/30D timeframe and the extended-hours basis,
  // so the leader shifts when either toggle flips (and intraday as prices
  // move). Eligible = rows that show a real % (full-access + allocation-only);
  // fully-blurred rows are skipped (their % is a placeholder) and so are rows
  // with no % yet (null → "—"). The comparison is sign-agnostic: on an all-red
  // day the least-negative row still leads. Only crowned when at least two rows
  // qualify — a leaderboard of one isn't a leaderboard.
  const topMoverId = useMemo(() => {
    let bestId: string | null = null;
    let bestPct = -Infinity;
    let eligible = 0;
    for (const p of portfolios) {
      const restricted = p.visibility !== 'public' && p.totalValue === null;
      if (restricted && !p.allocation_public) continue; // fully blurred — no real %
      const pct = getDisplayChangePercent(p, showExtendedHours, timeframe);
      if (pct === null) continue;
      eligible += 1;
      if (pct > bestPct) {
        bestPct = pct;
        bestId = p.id;
      }
    }
    return eligible >= 2 ? bestId : null;
  }, [portfolios, showExtendedHours, timeframe]);

  const topMoverLabel = timeframe === '30d' ? 'Top 30D' : 'Top today';

  const handleSignIn = async (userId: string, password: string) => {
    // Verify credentials via login endpoint — get token back
    const result = await loginToPortfolio(userId, password);

    // Token received, log in (use the canonical id the server returns)
    login(result.portfolioId, result.token, result.expiresAt);
    setShowSignIn(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header — relative z-20: backdrop-blur already makes this header its
          own stacking context, trapping the UserMenu dropdown's z-50 inside
          it. Without a z-index the context sits at z-auto, so the relative
          z-10 folder tabs below (MoversStrip/UpcomingEvents/Users), being
          later in the DOM, paint over the header — and over the open menu,
          bleeding the "Top movers"/"Upcoming" titles through it. z-20 lifts
          the header (and its menu) above those tabs, below the z-50 modals. */}
      <header className="relative z-20 border-b border-border bg-card/50 backdrop-blur-sm">
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
            <MoversStrip
              movers={
                (showExtendedHours
                  ? data?.movers?.extended
                  : data?.movers?.regular) ?? []
              }
            />

            {/* Upcoming macro releases + held-ticker earnings. Self-fetching
                (useUpcomingEvents) and self-hiding when the feed is empty. */}
            <UpcomingEvents />

            {/* Portfolios List — same notepad-tab shell as the movers/upcoming
                strips above, so the three read as a matched stack. A folder tab
                (users icon + "Users") juts from the card's top-left; the rows
                fill the card body below. The timeframe toggle that once lived in
                this header now lives in UserMenu's "30-Day View" row — same
                setting, promoted to a global preference. */}
            <div aria-label="Tracked portfolios">
              {/* Folder tab jutting from the card's top-left — users icon +
                  label, no bottom border, z-10 so it paints over the card body's
                  top border into one connected notepad-tab shape. Matches the
                  movers/upcoming strips' tabs, including the shared fixed width
                  (w-36) that keeps all three tabs at a constant width. */}
              <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
                <Users className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
                <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
                  Users
                </span>
              </div>

              {/* Card body: top-left squared to line up flush under the tab,
                  pulled up 1px to overlap the tab's missing bottom border.
                  overflow-hidden clips the per-row hover backgrounds to the
                  rounded corners. */}
              <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none overflow-hidden">
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
                    const displayChangePercent = getDisplayChangePercent(
                      portfolio,
                      showExtendedHours,
                      timeframe,
                    );
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
                        isTopMover={portfolio.id === topMoverId}
                        topMoverLabel={topMoverLabel}
                      />
                    );
                  })}
                </div>
              )}
              </div>
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
