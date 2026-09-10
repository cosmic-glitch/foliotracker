import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
  // When price_override is set, price IS the override (an exact figure).
  price: number | null;
  // The un-overridden EOD estimate (null for static rows). Missing (undefined)
  // on rows fetched before migration 013 — fall back to price when no
  // override is set.
  estimated_price?: number | null;
  // Owner-corrected per-share price (null = EOD estimate). Missing (undefined)
  // on rows fetched before migration 013 — treat as null.
  price_override?: number | null;
  // Free-text annotation, e.g. ESPP / RSU vest (null = none).
  note?: string | null;
}

export interface HoldingsHistoryPatch {
  price_override?: number | null;
  note?: string | null;
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

// Owner-only edit of one entry (price correction and/or note). Requires the
// owner/admin session token — the server rejects anything else. On success the
// updated row replaces the cached one immediately, then the query is
// invalidated so the cache re-syncs with the server.
export function useUpdateHoldingsHistoryEntry(portfolioId: string, token: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, patch }: { entryId: string; patch: HoldingsHistoryPatch }) => {
      if (!token) throw new Error('Sign in to edit history entries');
      const url = new URL(`${API_BASE_URL}/api/holdings-history`, window.location.origin);
      url.searchParams.set('id', portfolioId);
      url.searchParams.set('entry_id', entryId);
      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Failed to update entry');
      }
      return (await res.json()) as { entry: HoldingsHistoryEntry };
    },
    onSuccess: ({ entry }) => {
      queryClient.setQueriesData<HoldingsHistoryEntry[]>(
        { queryKey: ['holdingsHistory', portfolioId] },
        (old) => old?.map((e) => (e.id === entry.id ? entry : e))
      );
      void queryClient.invalidateQueries({ queryKey: ['holdingsHistory', portfolioId] });
    },
  });
}

// Owner-only removal of one entry. Requires the owner/admin session token —
// the server rejects anything else. On success the row is dropped from every
// cached history query for this portfolio immediately (no flash of the old
// list), then the query is invalidated so the cache re-syncs with the server.
export function useDeleteHoldingsHistoryEntry(portfolioId: string, token: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      if (!token) throw new Error('Sign in to delete history entries');
      const url = new URL(`${API_BASE_URL}/api/holdings-history`, window.location.origin);
      url.searchParams.set('id', portfolioId);
      url.searchParams.set('entry_id', entryId);
      url.searchParams.set('token', token);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Failed to delete entry');
      }
      return entryId;
    },
    onSuccess: (entryId) => {
      queryClient.setQueriesData<HoldingsHistoryEntry[]>(
        { queryKey: ['holdingsHistory', portfolioId] },
        (old) => old?.filter((e) => e.id !== entryId)
      );
      void queryClient.invalidateQueries({ queryKey: ['holdingsHistory', portfolioId] });
    },
  });
}
