import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ArrowLeftRight, Check, Copy, TrendingUp } from 'lucide-react';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { useUnlockedPortfolios } from '../hooks/useUnlockedPortfolios';
import { usePortfolioList, isComparable } from '../hooks/usePortfolioList';
import { portfolioKeys } from '../hooks/usePortfolioData';
import { consolidateHoldings } from '../utils/equivalentTickers';
import type { Holding } from '../types/portfolio';
import { Footer } from '../components/Footer';

const MAX_COMPARE = 4;
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface CompareResult {
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
  // only field this page reads, so restricted portfolios compare safely.
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

type CompareEntry =
  | { status: 'ok'; result: CompareResult }
  | { status: 'error'; id: string; message: string }
  | { status: 'loading'; id: string };

function formatPct(v: number | null): string {
  if (v === null) return '—';
  return `${v.toFixed(1)}%`;
}

type RowFilter = 'all' | 'common' | 'different';

export function ComparePage() {
  const { loggedInAs, getToken: getLoginToken } = useLoggedInPortfolio();
  const { getToken: getUnlockedToken } = useUnlockedPortfolios();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rowFilter, setRowFilter] = useState<RowFilter>('common');
  const [includeStatic, setIncludeStatic] = useState(true);
  const [copied, setCopied] = useState(false);

  // Selection lives in the URL (?ids=a,b,c) so comparisons are shareable.
  const selectedIds = useMemo(() => {
    const raw = searchParams.get('ids') ?? '';
    const ids = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(ids)].slice(0, MAX_COMPARE);
  }, [searchParams]);

  const setSelectedIds = (ids: string[]) => {
    const next = new URLSearchParams(searchParams);
    if (ids.length === 0) next.delete('ids');
    else next.set('ids', ids.join(','));
    setSearchParams(next, { replace: true });
  };

  const toggleId = (id: string) => {
    const key = id.toLowerCase();
    if (selectedIds.includes(key)) {
      setSelectedIds(selectedIds.filter((s) => s !== key));
    } else if (selectedIds.length < MAX_COMPARE) {
      setSelectedIds([...selectedIds, key]);
    }
  };

  // Same token resolution as the detail page (App.tsx): a password-unlocked
  // portfolio's session token, or the login token when logged in as this id.
  // Without it the server treats owners as restricted and private portfolios
  // load as inaccessible. (?share= tokens are single-portfolio and out of
  // scope for comparison.)
  const tokenFor = (id: string): string | null =>
    getUnlockedToken(id) ?? (loggedInAs === id ? getLoginToken() : null);

  // Shared list query — same key + full-response fetcher as the landing page,
  // so the two pages can't poison each other's cache with divergent shapes.
  const { data: listData, isLoading: listLoading } = usePortfolioList(loggedInAs);
  const portfolioList = useMemo(() => listData?.portfolios ?? [], [listData]);

  const comparable = useMemo(() => portfolioList.filter(isComparable), [portfolioList]);
  const comparableById = useMemo(
    () => new Map(comparable.map((p) => [p.id.toLowerCase(), p])),
    [comparable],
  );

  // IDs in the URL the viewer can't access (private, opted out) — offered for
  // removal rather than silently dropped. Gated on listLoading: while the list
  // is in flight every id looks unknown, and Remove would wipe a shared URL.
  const unknownIds = useMemo(
    () => (listLoading ? [] : selectedIds.filter((id) => !comparableById.has(id))),
    [selectedIds, comparableById, listLoading],
  );

  const validIds = useMemo(
    () => selectedIds.filter((id) => comparableById.has(id)),
    [selectedIds, comparableById],
  );

  // One query per portfolio, keyed like the detail page (portfolioKeys.detail
  // + auth suffix). Toggling a checkbox only fetches the added id, successes
  // share cache with the detail page, one failure can't blank the rest, and
  // EditPortfolio's ['portfolio', id] invalidation applies here too.
  const compareQueries = useQueries({
    queries: validIds.map((id) => ({
      queryKey: [...portfolioKeys.detail(id), tokenFor(id) ?? 'no-auth', loggedInAs ?? 'no-login'],
      queryFn: () => fetchComparePortfolio(id, tokenFor(id), loggedInAs),
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })),
  });

  const entries: CompareEntry[] = validIds.map((id, i) => {
    const q = compareQueries[i];
    if (q.data) return { status: 'ok', result: q.data };
    if (q.error) return { status: 'error', id, message: q.error.message };
    return { status: 'loading', id };
  });

  const compareLoading = compareQueries.some((q) => q.isLoading);
  // Settled payloads, memoized on the stable query results (not on
  // render-created arrays, which the React Compiler can't preserve).
  const okResults = useMemo(() => {
    const out: CompareResult[] = [];
    for (const q of compareQueries) {
      if (q.data) out.push(q.data);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validIds, compareQueries]);
  const inaccessible = okResults.filter((r) => r.inaccessible);
  const pendingList = okResults.filter((r) => r.pending);
  const failed = entries.filter(
    (e): e is { status: 'error'; id: string; message: string } => e.status === 'error',
  );

  // Per-portfolio ticker → allocation % map. Holdings pass through
  // consolidateHoldings (GOOG/GOOGL merged) like AllocationView. Excluding
  // static rows only hides them — percentages stay as a share of net worth
  // and are deliberately NOT renormalized, so a column may sum below 100%.
  const allocMaps = useMemo(() => {
    return okResults
      .filter((r) => !r.inaccessible && !r.pending)
      .map((r) => {
        const consolidated = consolidateHoldings(r.holdings);
        const kept = includeStatic ? consolidated : consolidated.filter((h) => !h.isStatic);
        const map = new Map<string, number>();
        for (const h of kept) map.set(h.ticker, h.allocation);
        return { id: r.id, displayName: r.displayName, map };
      });
  }, [okResults, includeStatic]);

  const rows = useMemo(() => {
    const tickers = new Set<string>();
    for (const p of allocMaps) for (const t of p.map.keys()) tickers.add(t);
    const all = [...tickers].map((ticker) => {
      const pcts = allocMaps.map((p) => p.map.get(ticker) ?? null);
      const present = pcts.filter((v): v is number => v !== null && v > 0).length;
      const max = Math.max(0, ...pcts.map((v) => v ?? 0));
      return { ticker, pcts, present, max };
    });
    const filtered = all.filter((r) => {
      if (rowFilter === 'common') return r.present >= 2;
      if (rowFilter === 'different') return r.present === 1;
      return true;
    });
    return filtered.sort((a, b) => b.max - a.max || a.ticker.localeCompare(b.ticker));
  }, [allocMaps, rowFilter]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const showTable = allocMaps.length >= 2;
  const loading = listLoading || (validIds.length > 0 && compareLoading);

  // Latest snapshot timestamp across compared portfolios — null (footer
  // hidden, like the landing page) until at least one result has loaded.
  const footerUpdated = useMemo(() => {
    const dates = okResults
      .filter((r) => !r.inaccessible && !r.pending)
      .map((r) => (r.lastUpdated ? new Date(r.lastUpdated) : null))
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }, [okResults]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-2 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="p-2 bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors" title="All Portfolios">
                <TrendingUp className="w-6 h-6 text-accent" />
              </Link>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-text-secondary" />
                Compare
              </h1>
            </div>
            <button
              onClick={copyLink}
              disabled={validIds.length < 2}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy link'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-3 md:py-8 space-y-4">
        {/* Picker — names are short, so chips wrap into a few rows instead
            of one tall row-per-portfolio list. */}
        <section aria-label="Select portfolios" className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">
              Portfolios ({selectedIds.length}/{MAX_COMPARE})
            </h2>
            {selectedIds.length > 0 && (
              <button
                onClick={() => setSelectedIds([])}
                className="text-xs underline text-text-secondary hover:text-text-primary"
              >
                Clear
              </button>
            )}
          </div>
          <div className="p-3">
            {listLoading ? (
              <div className="p-4 text-center text-sm text-text-secondary">Loading portfolios...</div>
            ) : comparable.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-secondary">
                No portfolios you can access yet.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {comparable.map((p) => {
                  const checked = selectedIds.includes(p.id.toLowerCase());
                  const full = !checked && selectedIds.length >= MAX_COMPARE;
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleId(p.id)}
                      aria-pressed={checked}
                      disabled={full}
                      title={p.display_name ? p.id : undefined}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        checked
                          ? 'bg-accent border-accent text-white'
                          : 'border-border text-text-primary hover:bg-card-hover disabled:opacity-40 disabled:hover:bg-transparent'
                      }`}
                    >
                      {(p.display_name || p.id).toUpperCase()}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {unknownIds.length > 0 && (
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
            No access to: {unknownIds.join(', ').toUpperCase()}.{' '}
            <button
              onClick={() => setSelectedIds(validIds)}
              className="underline text-accent hover:text-accent/80"
            >
              Remove
            </button>
          </div>
        )}

        {inaccessible.length > 0 && (
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
            No access to: {inaccessible.map((r) => r.id.toUpperCase()).join(', ')}.{' '}
            <button
              onClick={() => setSelectedIds(validIds.filter((id) => !inaccessible.some((r) => r.id === id)))}
              className="underline text-accent hover:text-accent/80"
            >
              Remove
            </button>
          </div>
        )}

        {failed.length > 0 && (
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
            Couldn't load: {failed.map((f) => `${f.id.toUpperCase()} (${f.message})`).join(', ')}.{' '}
            <button
              onClick={() => setSelectedIds(validIds.filter((id) => !failed.some((f) => f.id === id)))}
              className="underline text-accent hover:text-accent/80"
            >
              Remove
            </button>
          </div>
        )}

        {pendingList.length > 0 && (
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
            Waiting on first snapshot for {pendingList.map((r) => r.id.toUpperCase()).join(', ')} —{' '}
            check back after the next refresh cycle.
          </div>
        )}

        {!loading && validIds.length === 1 && (
          <div className="text-center text-sm text-text-secondary py-6">
            Select at least one more portfolio to compare allocations.
          </div>
        )}

        {showTable && (
          <section aria-label="Allocation comparison" className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg overflow-hidden border border-border text-xs mr-auto">
                {(['all', 'common', 'different'] as RowFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setRowFilter(f)}
                    className={`px-3 py-1.5 capitalize transition-colors ${
                      rowFilter === f ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {f === 'common' ? 'In common' : f === 'different' ? 'Different' : 'All'}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIncludeStatic(!includeStatic)}
                className="text-xs underline text-text-secondary hover:text-text-primary"
              >
                {includeStatic ? 'Exclude cash/static' : 'Include cash/static'}
              </button>
            </div>
            {/* Horizontal scroll with sticky ticker column keeps the table
                usable on narrow phones even with 4 portfolios selected. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 bg-card text-left font-semibold text-text-secondary text-xs px-4 py-2 min-w-[72px]">
                      Ticker
                    </th>
                    {allocMaps.map((p) => (
                      <th
                        key={p.id}
                        className="text-right font-semibold text-text-primary text-xs px-3 py-2 min-w-[86px]"
                      >
                        <span className="block truncate max-w-[110px] ml-auto">
                          {(p.displayName || p.id).toUpperCase()}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.ticker}>
                      <td className="sticky left-0 bg-card font-mono font-medium text-text-primary px-4 py-2">
                        {row.ticker}
                      </td>
                      {row.pcts.map((pct, i) => (
                        <td key={allocMaps[i].id} className="text-right px-3 py-2 tabular-nums">
                          {pct === null || pct <= 0 ? (
                            <span className="text-text-secondary/50">—</span>
                          ) : (
                            <>
                              <span className="text-text-primary">{formatPct(pct)}</span>
                              <span
                                className="block ml-auto mt-0.5 h-1 rounded-full bg-accent/70"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={allocMaps.length + 1}
                        className="text-center text-sm text-text-secondary px-4 py-8"
                      >
                        No holdings match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2.5 text-[11px] text-text-secondary border-t border-border">
              Allocation percentages of net worth — sorted by largest weight. Holdings are
              consolidated the same way as the portfolio page.
              {!includeStatic && ' Cash/static rows are hidden, not redistributed.'}
            </p>
          </section>
        )}
      </main>

      {footerUpdated && (
        <Footer lastUpdated={footerUpdated} />
      )}
    </div>
  );
}
