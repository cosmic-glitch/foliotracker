import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useLoggedInPortfolio } from './useLoggedInPortfolio';
import { useUnlockedPortfolios } from './useUnlockedPortfolios';
import { portfolioKeys } from './usePortfolioData';
import type { Holding } from '../types/portfolio';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface CompareResult {
  id: string;
  displayName: string | null;
  holdings: Holding[];
  // requiresAuth stub or 404: the viewer can't see even allocations.
  inaccessible: boolean;
  // 200 carrying the server's "snapshot not yet available" message with no
  // holdings — not an empty portfolio, just not computable yet.
  pending: boolean;
  lastUpdated: string | null;
}

async function fetchComparePortfolio(
  id: string,
  token: string | null,
  loggedInAs: string | null,
): Promise<CompareResult> {
  const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
  url.searchParams.set('id', id);
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (response.status === 404) {
    return { id, displayName: null, holdings: [], inaccessible: true, pending: false, lastUpdated: null };
  }
  if (!response.ok) throw new Error(`Failed to fetch ${id} (${response.status})`);
  const json = await response.json();
  // Allocation-only responses zero out $ fields but keep `allocation` — the
  // only field the compare views read, so restricted portfolios compare safely.
  if (json.requiresAuth || !Array.isArray(json.holdings)) {
    return { id, displayName: json.displayName ?? null, holdings: [], inaccessible: true, pending: false, lastUpdated: null };
  }
  const pending = json.holdings.length === 0 && typeof json.message === 'string';
  return {
    id,
    displayName: json.displayName ?? null,
    holdings: json.holdings as Holding[],
    inaccessible: false,
    pending,
    lastUpdated: typeof json.lastUpdated === 'string' ? json.lastUpdated : null,
  };
}

export type CompareEntry =
  | { status: 'ok'; result: CompareResult }
  | { status: 'error'; id: string; message: string }
  | { status: 'loading'; id: string };

// Per-portfolio payloads for both compare views (portfolios and ticker).
export function useComparePortfolios(ids: string[]) {
  const { loggedInAs, getToken: getLoginToken } = useLoggedInPortfolio();
  const { getToken: getUnlockedToken } = useUnlockedPortfolios();

  // Same token resolution as the detail page (App.tsx): a password-unlocked
  // portfolio's session token, or the login token when logged in as this id.
  // Without it the server treats owners as restricted and private portfolios
  // load as inaccessible. (?share= tokens are single-portfolio and out of
  // scope for comparison.)
  const tokenFor = (id: string): string | null =>
    getUnlockedToken(id) ?? (loggedInAs === id ? getLoginToken() : null);

  // One query per portfolio, keyed like the detail page (portfolioKeys.detail
  // + auth suffix). Adding an id only fetches that id, successes share cache
  // with the detail page (and between the two compare views), one failure
  // can't blank the rest, and EditPortfolio's ['portfolio', id] invalidation
  // applies here too.
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...portfolioKeys.detail(id), tokenFor(id) ?? 'no-auth', loggedInAs ?? 'no-login'],
      queryFn: () => fetchComparePortfolio(id, tokenFor(id), loggedInAs),
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })),
  });

  const entries: CompareEntry[] = ids.map((id, i) => {
    const q = queries[i];
    if (q.data) return { status: 'ok', result: q.data };
    if (q.error) return { status: 'error', id, message: q.error.message };
    return { status: 'loading', id };
  });

  // Settled payloads, memoized on the stable query results (not on
  // render-created arrays, which the React Compiler can't preserve).
  const okResults = useMemo(() => {
    const out: CompareResult[] = [];
    for (const q of queries) {
      if (q.data) out.push(q.data);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, queries]);

  const failed = entries.filter(
    (e): e is { status: 'error'; id: string; message: string } => e.status === 'error',
  );

  return {
    okResults,
    failed,
    loading: queries.some((q) => q.isLoading),
  };
}

// Latest snapshot timestamp across results — null (footer hidden, like the
// landing page) until at least one usable result has loaded.
export function latestUpdated(results: CompareResult[]): Date | null {
  const dates = results
    .filter((r) => !r.inaccessible && !r.pending)
    .map((r) => (r.lastUpdated ? new Date(r.lastUpdated) : null))
    .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}
