import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Plus, Users, Lock, LogIn, LogOut, ChevronRight, UserPlus, Briefcase, Shield, Sparkles, Trophy } from 'lucide-react';
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
  // TRUE when today's 1D move can't be known yet — every market-priced holding
  // is a once-daily fund whose NAV hasn't repriced this session (see
  // isDayChangeUnknown in api/portfolios.ts). The row shows "—" for the day
  // move and is excluded from the "Top today" leader. Optional so older cached
  // payloads (undefined) degrade to "known". Only affects 1D, not 30D.
  dayChangeUnknown?: boolean;
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
  // 1D: a funds-only portfolio whose NAV hasn't repriced today has an unknown
  // day move (the stale-NAV reset zeroed it). Return null — not a flat 0% —
  // so the row renders "—" and is skipped from the "Top today" leader, rather
  // than falsely winning on a red day. (30D above is unaffected: a multi-week
  // move stays knowable even when today's NAV is a day stale.)
  if (p.dayChangeUnknown) return null;
  return showExtendedHours
    ? (p.dayChangePercent ?? 0)
    : (p.regularDayChangePercent ?? p.dayChangePercent ?? 0);
}

// The dollar total a row displays, honoring the extended-hours basis. Shown as
// secondary context in each row (the board ranks by today's move, not size).
function getDisplayValue(p: Portfolio, showExtendedHours: boolean): number {
  return showExtendedHours
    ? (p.totalValue ?? 0)
    : (p.regularTotalValue ?? p.totalValue ?? 0);
}

// The shared demo portfolio is a sample for visitors to explore, not a real
// competitor — it's excluded from the ranking and always sorted dead last (see
// getRankMetric + the sort comparator). Keyed by id since there's no is_demo
// column; the same id the mock-data fallback uses (src/lib/mockData.ts).
const DEMO_PORTFOLIO_ID = 'demo';
function isDemoPortfolio(p: Portfolio): boolean {
  return p.id.toLowerCase() === DEMO_PORTFOLIO_ID;
}

// The metric the leaderboard ranks by: the row's displayed day-change % (1D) or
// 30-day % (30D), per the active timeframe + extended-hours basis. Returns null
// for rows excluded from the ranking — the demo portfolio (a sample, not a
// competitor), fully-blurred portfolios (no access; the % is a placeholder), and
// rows whose move isn't known yet (stale-NAV funds in 1D, brand-new portfolios
// in 30D). Null-metric rows sink to the bottom, unranked (the demo last of all).
function getRankMetric(
  p: Portfolio,
  showExtendedHours: boolean,
  timeframe: Timeframe,
): number | null {
  if (isDemoPortfolio(p)) return null;
  const fullyBlurred =
    p.visibility !== 'public' && p.totalValue === null && !p.allocation_public;
  if (fullyBlurred) return null;
  return getDisplayChangePercent(p, showExtendedHours, timeframe);
}

interface PortfolioListRowProps {
  portfolio: Portfolio;
  // Portfolio total — the row's prominent dollar figure (larger, bold, primary
  // color). It is NOT the ranking key: the board still ranks by % move (see the
  // caption + getRankMetric); the dollar is just shown with full visual weight
  // because it's a headline number visitors care about. Full comma-grouped
  // figure; tap-to-reveal animates it up to the 52w peak.
  displayValue: number;
  // 52-week-high "peak potential" total; tapping the value counts up to this.
  peakPotentialValue: number;
  // Today's move % — the ranked metric, rendered as a smaller colored delta to
  // the right of the dollar total (color carries the up/down signal; the dollar
  // is the dominant figure). null when the active timeframe has no figure
  // (renders "—").
  displayChangePercent: number | null;
  shouldBlurValues: boolean;
  // When true, the row is restricted but allocation_public is ON: hide the $
  // total (a lock) but still show the day-change %.
  restrictedAllocOnly: boolean;
  // Leaderboard rank by today's move (1..N). null for rows with no real % —
  // they sink to the bottom and render "—".
  rank: number | null;
  // True for the day's leader (rank 1, when there are ≥2 ranked rows): gold
  // trophy in the rank slot. No row wash — the trophy + top position already say
  // "winner"; a third cue for the same fact is redundant.
  isLeader: boolean;
}

function PortfolioListRow({
  portfolio,
  displayValue,
  peakPotentialValue,
  displayChangePercent,
  shouldBlurValues,
  restrictedAllocOnly,
  rank,
  isLeader,
}: PortfolioListRowProps) {
  const { animatedValue, isRevealing, triggerReveal, onKeyDown } = usePeakReveal(
    displayValue,
    peakPotentialValue,
  );
  const canReveal = !shouldBlurValues && peakPotentialValue > displayValue;
  const pct = displayChangePercent;
  const hasPct = pct !== null;
  const pctColor = !hasPct
    ? 'text-text-secondary'
    : pct! >= 0
    ? 'text-positive'
    : 'text-negative';

  return (
    // One row, the whole thing a tap target (the per-row "View" button is gone,
    // replaced by a trailing chevron). No per-row wash and no own-row accent —
    // every row reads the same; the leader is marked by the trophy + top
    // position alone.
    <Link
      to={`/${portfolio.id}`}
      aria-label={`View ${portfolio.id.toUpperCase()} portfolio`}
      className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-card-hover"
    >
      {/* Rank — fixed-width so the chips line up down the list. The day's leader
          shows a gold trophy instead of "1"; unranked rows (no real %) are
          blank here and render "—" on the right. */}
      <span className="flex w-5 shrink-0 justify-end text-xs tabular-nums text-text-secondary">
        {isLeader ? (
          <Trophy className="w-3.5 h-3.5 text-amber-500" aria-label="Top today" />
        ) : (
          rank ?? ''
        )}
      </span>

      {/* Identity chip — the handle in a transparent pill with one faint,
          neutral border (same outline for every user). The border is pure
          containment, not identity: there's no per-user color, so users are
          told apart by the name text alone. Deliberately uncolored — an
          arbitrary identity hue shouldn't compete with the meaningful
          green/red move color, and a single border reads quietly down the
          list. Legible on both themes (border-border tracks the card edge). */}
      <span className="max-w-[8rem] shrink-0 truncate rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-text-primary">
        {portfolio.id.toUpperCase()}
      </span>

      {/* Right cluster, pushed to the row's edge: portfolio total (the dominant
          figure — larger, bold, full comma-grouped, primary color) then today's
          move % (the ranked metric, a smaller colored delta in the rightmost
          column so the descending sort still reads cleanly; color carries the
          up/down signal). The total is tap-to-reveal: it counts up to the 52w
          peak and the % slot swaps to a "52w high" cue while revealing. */}
      <div className="ml-auto flex shrink-0 items-baseline gap-3">
        {shouldBlurValues ? (
          <span className="text-base font-semibold tabular-nums text-text-secondary blur-sm select-none">
            $X,XXX,XXX
          </span>
        ) : restrictedAllocOnly ? (
          // No owner-level access, but allocation_public is ON: hide the $ total
          // (a lock) — the % to its right is the only figure this viewer sees.
          <Lock className="w-3.5 h-3.5 text-text-secondary" aria-label="Value hidden" />
        ) : (
          // The row is a link, so the reveal handlers preventDefault +
          // stopPropagation to intercept the tap (count up to the 52w peak)
          // instead of navigating to the portfolio.
          <span
            className={`text-base font-semibold tabular-nums whitespace-nowrap ${
              isRevealing ? 'text-amber-400' : 'text-text-primary'
            } ${canReveal ? 'cursor-pointer select-none' : ''}`}
            onClick={
              canReveal
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerReveal();
                  }
                : undefined
            }
            role={canReveal ? 'button' : undefined}
            tabIndex={canReveal ? 0 : undefined}
            onKeyDown={
              canReveal
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                    onKeyDown(e);
                  }
                : undefined
            }
          >
            ${animatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        )}

        {shouldBlurValues ? (
          <span className="text-sm font-semibold tabular-nums text-positive blur-sm select-none">
            +0.00%
          </span>
        ) : isRevealing ? (
          <span className="flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-amber-400 animate-[fadeIn_0.2s_ease-out]">
            <Sparkles className="w-3 h-3" />
            52w high
          </span>
        ) : hasPct ? (
          <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${pctColor}`}>
            {pct! >= 0 ? '+' : ''}{pct!.toFixed(2)}%
          </span>
        ) : (
          <span className="text-sm font-semibold text-text-secondary">—</span>
        )}
      </div>

      {/* Chevron — the row itself is the tap target; this just signals "opens".
          Restricted viewers still land on the allocation-only detail page, or
          hit the password prompt — the same destination the old "View" had. */}
      <ChevronRight className="w-4 h-4 shrink-0 text-text-secondary/60" aria-hidden />
    </Link>
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

    // The list is a leaderboard ranked by TODAY'S MOVE (displayed day-change %),
    // not by portfolio size — a level field among friends, and deliberately not
    // a net-worth ranking. The metric honors the 1D/30D timeframe and the
    // extended-hours basis (see getRankMetric), so the order tracks the same %
    // each row shows and re-sorts when either toggle flips or prices move
    // intraday. The viewer is ranked in place like everyone else (not pinned),
    // so they see their true standing. Rows with no real % — fully-blurred
    // portfolios (no access) and ones whose move isn't known yet — have a null
    // metric and sink to the bottom in created_at (idx) order, which is also the
    // stable tiebreaker for equal percentages. The demo portfolio is always dead
    // last (below even the other unranked rows) — it's a sample, not a player.
    return [...raw]
      .map((p, idx) => ({
        p,
        idx,
        demo: isDemoPortfolio(p),
        metric: getRankMetric(p, showExtendedHours, timeframe),
      }))
      .sort((a, b) => {
        if (a.demo !== b.demo) return a.demo ? 1 : -1;
        if (a.metric === null && b.metric === null) return a.idx - b.idx;
        if (a.metric === null) return 1;
        if (b.metric === null) return -1;
        if (b.metric !== a.metric) return b.metric - a.metric;
        return a.idx - b.idx;
      })
      .map((e) => e.p);
  }, [data, showExtendedHours, timeframe]);

  // Rank by today's move, 1..N over the rows that have a real % (the list is
  // already sorted %-desc, so a running counter matches the displayed order).
  // The viewer is ranked in place like everyone else; null-metric rows stay
  // unranked and render "—".
  const rankById = useMemo(() => {
    const map: Record<string, number> = {};
    let rank = 0;
    for (const p of portfolios) {
      if (getRankMetric(p, showExtendedHours, timeframe) === null) continue;
      map[p.id] = ++rank;
    }
    return map;
  }, [portfolios, showExtendedHours, timeframe]);

  // Get most recent lastUpdated from all portfolios
  const latestUpdate = useMemo(() => {
    if (portfolios.length === 0) return null;
    return portfolios.reduce((latest, p) => {
      if (!p.lastUpdated) return latest;
      const pDate = new Date(p.lastUpdated);
      return !latest || pDate > latest ? pDate : latest;
    }, null as Date | null);
  }, [portfolios]);

  // How many rows have a real % (are ranked). The day's leader (rank 1) only
  // earns the trophy when at least two rows qualify — a leaderboard of one isn't
  // a leaderboard. The caption names the ranking basis so the order (and the
  // unsorted-looking dollar column beside it) reads as intentional.
  const rankedCount = Object.keys(rankById).length;
  const rankBasisLabel =
    timeframe === '30d' ? 'Ranked by 30-day move' : "Ranked by today's move";

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
                <>
                  {/* Caption: names the ranking basis so the order — and the
                      intentionally-unsorted dollar column beside it — reads as a
                      "today's move" leaderboard, not a net-worth one. */}
                  <div className="border-b border-border px-4 py-2 text-xs text-text-secondary">
                    {rankBasisLabel}
                  </div>
                  <div className="divide-y divide-border">
                    {portfolios.map((portfolio) => {
                      // Restricted = visibility !== public AND server omitted
                      // the dollar total. Owner-side: server returned full
                      // values, so isRestricted stays false.
                      const isRestricted =
                        portfolio.visibility !== 'public' && portfolio.totalValue === null;
                      const restrictedAllocOnly = isRestricted && portfolio.allocation_public;
                      const shouldBlurValues = isRestricted && !portfolio.allocation_public;
                      const displayValue = getDisplayValue(portfolio, showExtendedHours);
                      const peakPotentialValue = Math.max(
                        portfolio.peakPotentialValue ?? 0,
                        displayValue,
                      );
                      // Today's move % — the ranked metric. Null (unknown move /
                      // no 30D anchor) flows through so the row renders "—".
                      const displayChangePercent = getDisplayChangePercent(
                        portfolio,
                        showExtendedHours,
                        timeframe,
                      );
                      const rank = rankById[portfolio.id] ?? null;

                      return (
                        <PortfolioListRow
                          key={portfolio.id}
                          portfolio={portfolio}
                          displayValue={displayValue}
                          peakPotentialValue={peakPotentialValue}
                          displayChangePercent={displayChangePercent}
                          shouldBlurValues={shouldBlurValues}
                          restrictedAllocOnly={restrictedAllocOnly}
                          rank={rank}
                          isLeader={rank === 1 && rankedCount >= 2}
                        />
                      );
                    })}
                  </div>
                </>
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
