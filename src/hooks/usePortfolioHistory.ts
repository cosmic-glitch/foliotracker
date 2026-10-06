import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// 'recorded' = captured after that day's close; 'reconstructed' = backfilled
// with holdings known for the day; 'estimated' = backfilled with holdings
// carried from the nearest day they were known.
export type DailyValueSource = 'recorded' | 'reconstructed' | 'estimated';

export interface HistoryDayHolding {
  ticker: string;
  name: string;
  isStatic: boolean;
  instrumentType: string;
  weight: number; // % of that day's total value
  value: number | null; // null for allocation-only viewers
}

export interface HistoryDay {
  date: string; // YYYY-MM-DD
  source: DailyValueSource;
  totalValue: number | null; // null for allocation-only viewers
  holdings: HistoryDayHolding[];
}

export interface PortfolioHistoryResponse {
  displayName: string | null;
  allocationOnly: boolean;
  days: HistoryDay[];
}

async function fetchPortfolioHistory(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
): Promise<PortfolioHistoryResponse> {
  const url = new URL(`${API_BASE_URL}/api/history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  url.searchParams.set('range', 'all');
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  if (shareToken) url.searchParams.set('share_token', shareToken);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (res.status === 404) throw new Error('Portfolio not found');
  if (res.status === 401) throw new Error('Not authorized to view this portfolio');
  if (!res.ok) throw new Error('Failed to load portfolio history');
  const json = await res.json();
  return {
    displayName: json.displayName ?? null,
    allocationOnly: !!json.allocationOnly,
    days: json.days ?? [],
  };
}

export function usePortfolioHistory(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
) {
  return useQuery({
    queryKey: ['portfolio', portfolioId, 'daily-values', token ?? 'no-auth', loggedInAs ?? 'no-login', shareToken ?? 'no-share'],
    queryFn: () => fetchPortfolioHistory(portfolioId, token, loggedInAs, shareToken),
    enabled: !!portfolioId,
    // Rows only change once a day (after the close); no need to poll.
    staleTime: 10 * 60 * 1000,
  });
}
