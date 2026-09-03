import { useQuery } from '@tanstack/react-query';
import type { MarketMover } from '../components/MoversStrip';
import { isLiveMarketSession } from '../lib/market-hours';

// One row of the GET /api/portfolios response. Moved here from LandingPage so
// the compare page shares the fetcher, the ['portfolios', …] cache entry, and
// the access rule below — a second copy already white-screened Compare once
// (divergent cached shapes under one query key).
export interface Portfolio {
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

export interface PortfoliosResponse {
  portfolios: Portfolio[];
  count: number;
  maxPortfolios: number;
  canCreate: boolean;
  // Most-held tickers swinging ≥2% today; empty on quiet days. Two
  // independently-ranked lists, one per price basis — the strip shows `extended`
  // or `regular` depending on the Extended Hours toggle, matching the holdings
  // table and totals.
  movers?: { regular: MarketMover[]; extended: MarketMover[] };
  // Total view events recorded site-wide today (Pacific day). Shown as a
  // social-proof hook on the movers strip's tab row. Optional so older cached
  // payloads degrade to no counter.
  viewsToday?: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export async function fetchPortfolios(loggedInAs: string | null): Promise<PortfoliosResponse> {
  const url = new URL(`${API_BASE_URL}/api/portfolios`, window.location.origin);
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch portfolios');
  return response.json();
}

// Fully blurred = the server omitted dollar values AND the owner opted out of
// public allocation. The viewer sees the row but no numbers — the requiresAuth
// stub state.
export function isFullyBlurred(p: Portfolio): boolean {
  return (
    p.visibility !== 'public' &&
    p.totalValue === null &&
    !p.allocation_public
  );
}

// The shared demo portfolio is a sample for visitors to explore, not a real
// competitor — the landing page ranks it dead last and the compare page hides
// it. Keyed by id since there's no is_demo column; the same id the mock-data
// fallback uses (src/lib/mockData.ts).
const DEMO_PORTFOLIO_ID = 'demo';
export function isDemoPortfolio(p: Portfolio): boolean {
  return p.id.toLowerCase() === DEMO_PORTFOLIO_ID;
}

// Comparable on the compare page = anything but fully blurred or the demo.
// Allocation-only rows qualify: the page reads only allocation %, which the
// server still returns for them.
export function isComparable(p: Portfolio): boolean {
  return !isFullyBlurred(p) && !isDemoPortfolio(p);
}

export function usePortfolioList(loggedInAs: string | null) {
  return useQuery({
    queryKey: ['portfolios', loggedInAs],
    queryFn: () => fetchPortfolios(loggedInAs),
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchInterval: () => isLiveMarketSession() ? 60 * 1000 : 30 * 60 * 1000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}
