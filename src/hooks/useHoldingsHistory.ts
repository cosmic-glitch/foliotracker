import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface HoldingsHistoryEntry {
  id: string;
  portfolio_id: string;
  ticker: string;
  name: string;
  shares: number;
  prev_shares: number | null;
  is_static: boolean;
  static_value: number | null;
  // Value before an 'updated'/'removed' static change. Null on rows logged
  // before it was recorded; materialSessions derives it from earlier rows.
  prev_static_value: number | null;
  instrument_type: string | null;
  cost_basis: number | null;
  change_type: 'added' | 'updated' | 'removed';
  recorded_at: string;
  // Close on the recorded day (null for static rows or when no price is known).
  price: number | null;
}

interface HoldingsHistoryResponse {
  history: HoldingsHistoryEntry[];
}

async function fetchHoldingsHistory(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
): Promise<HoldingsHistoryEntry[]> {
  const url = new URL(`${API_BASE_URL}/api/holdings-history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  if (shareToken) url.searchParams.set('share_token', shareToken);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (res.status === 403 || res.status === 401) {
    // Not authorized for history (allocation-only viewer) — treat as empty
    return [];
  }
  if (!res.ok) throw new Error('Failed to fetch holdings history');
  const json = (await res.json()) as HoldingsHistoryResponse;
  return json.history || [];
}

export function useHoldingsHistory(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: ['holdingsHistory', portfolioId, token ?? 'no-token', loggedInAs ?? 'no-login', shareToken ?? 'no-share'],
    queryFn: () => fetchHoldingsHistory(portfolioId, token, loggedInAs, shareToken),
    enabled: !!portfolioId && enabled,
    staleTime: 60_000,
    retry: false,
  });
}
