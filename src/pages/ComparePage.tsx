import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeftRight, Check, Copy, TrendingUp } from 'lucide-react';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { usePortfolioList, isComparable } from '../hooks/usePortfolioList';
import { useComparePortfolios, latestUpdated } from '../hooks/useComparePortfolios';
import { canonicalTicker, consolidateHoldings } from '../utils/equivalentTickers';
import { Footer } from '../components/Footer';
import { AllocationBar } from '../components/AllocationBar';
import { TickerCompare } from '../components/TickerCompare';

type RowFilter = 'all' | 'common' | 'different';
type View = 'portfolios' | 'ticker';

export function ComparePage() {
  const { loggedInAs } = useLoggedInPortfolio();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rowFilter, setRowFilter] = useState<RowFilter>('common');
  const [includeStatic, setIncludeStatic] = useState(true);
  // Portfolio id whose column drives the row order; null = default sort by
  // the largest weight in any column. Clicking a header toggles it.
  const [sortById, setSortById] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Both views keep their state in the URL so links are shareable:
  // ?ids=a,b,c (portfolios view) and ?view=ticker&ticker=NVDA. Each view's
  // param survives switching to the other and back.
  const view: View = searchParams.get('view') === 'ticker' ? 'ticker' : 'portfolios';
  const ticker = useMemo(() => {
    const raw = searchParams.get('ticker')?.trim().toUpperCase();
    return raw ? canonicalTicker(raw) : null;
  }, [searchParams]);

  const updateParams = (mutate: (next: URLSearchParams) => void, replace = true) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const setView = (v: View) =>
    updateParams((next) => {
      if (v === 'ticker') next.set('view', 'ticker');
      else next.delete('view');
    });

  const setTicker = (t: string | null) =>
    updateParams((next) => {
      if (t) next.set('ticker', t);
      else next.delete('ticker');
    });

  // From a portfolios-table row: a real navigation (pushes history) so Back
  // returns to the table.
  const openTickerView = (t: string) => {
    updateParams((next) => {
      next.set('view', 'ticker');
      next.set('ticker', t);
    }, false);
    window.scrollTo({ top: 0 });
  };

  // Selection lives in the URL (?ids=a,b,c) so comparisons are shareable.
  const selectedIds = useMemo(() => {
    const raw = searchParams.get('ids') ?? '';
    const ids = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [searchParams]);

  const setSelectedIds = (ids: string[]) =>
    updateParams((next) => {
      if (ids.length === 0) next.delete('ids');
      else next.set('ids', ids.join(','));
    });

  const toggleId = (id: string) => {
    const key = id.toLowerCase();
    if (selectedIds.includes(key)) {
      setSelectedIds(selectedIds.filter((s) => s !== key));
    } else {
      setSelectedIds([...selectedIds, key]);
    }
  };

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

  // The ticker view looks across every portfolio the viewer can see; the
  // portfolios view only fetches the selection. Same query keys either way,
  // so switching views reuses whatever is already cached.
  const comparableIds = useMemo(() => comparable.map((p) => p.id.toLowerCase()), [comparable]);
  const fetchIds = view === 'ticker' ? comparableIds : validIds;
  const { okResults, failed, loading: compareLoading } = useComparePortfolios(fetchIds);

  const inaccessible = okResults.filter((r) => r.inaccessible);
  const pendingList = okResults.filter((r) => r.pending);

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
        // Canonical keys so GOOG in one portfolio and GOOGL in another share
        // a row (consolidateHoldings only merges within a portfolio).
        const map = new Map<string, number>();
        for (const h of kept) {
          const t = canonicalTicker(h.ticker);
          map.set(t, (map.get(t) ?? 0) + h.allocation);
        }
        return { id: r.id, displayName: r.displayName, map };
      });
  }, [okResults, includeStatic]);

  // Static names (cash, property) aren't tickers, so their rows don't link
  // into the ticker view.
  const staticNames = useMemo(() => {
    const out = new Set<string>();
    for (const r of okResults) for (const h of r.holdings) if (h.isStatic) out.add(h.ticker);
    return out;
  }, [okResults]);

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
    const sortIdx = sortById === null ? -1 : allocMaps.findIndex((p) => p.id === sortById);
    // Sort by the chosen column desc (missing/zero holdings last), falling
    // back to the max-weight order so ties and the default stay stable.
    const key = (r: (typeof all)[number]) => (sortIdx >= 0 ? (r.pcts[sortIdx] ?? 0) : r.max);
    return filtered.sort((a, b) => key(b) - key(a) || b.max - a.max || a.ticker.localeCompare(b.ticker));
  }, [allocMaps, rowFilter, sortById]);

  // One shared scale across every column so bar lengths compare honestly
  // between portfolios, not just within one — the largest visible weight
  // fills its cell, everything else is proportional to it.
  const tableMax = useMemo(() => Math.max(0, ...rows.map((r) => r.max)), [rows]);

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
  const loading = listLoading || (fetchIds.length > 0 && compareLoading);
  const footerUpdated = useMemo(() => latestUpdated(okResults), [okResults]);

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
              disabled={view === 'ticker' ? !ticker : validIds.length < 2}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy link'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-3 md:py-8 space-y-4">
        <div role="tablist" aria-label="Compare by" className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
          {(['portfolios', 'ticker'] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`px-4 py-2 font-medium transition-colors ${
                view === v ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {v === 'portfolios' ? 'Portfolios' : 'Ticker'}
            </button>
          ))}
        </div>

        {view === 'ticker' ? (
          listLoading ? (
            <div className="text-center text-sm text-text-secondary py-6">Loading portfolios...</div>
          ) : (
            <TickerCompare
              results={okResults}
              failed={failed}
              loading={compareLoading}
              ticker={ticker}
              onSelectTicker={setTicker}
            />
          )
        ) : (
        <>
        {/* Picker — names are short, so chips wrap into a few rows instead
            of one tall row-per-portfolio list. */}
        <section aria-label="Select portfolios" className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">
              Portfolios{selectedIds.length > 0 && ` (${selectedIds.length} selected)`}
            </h2>
            <div className="flex items-center gap-3">
              {comparable.length > 0 && validIds.length < comparable.length && (
                <button
                  onClick={() => setSelectedIds(comparableIds)}
                  className="text-xs underline text-text-secondary hover:text-text-primary"
                >
                  Select all
                </button>
              )}
              {selectedIds.length > 0 && (
                <button
                  onClick={() => setSelectedIds([])}
                  className="text-xs underline text-text-secondary hover:text-text-primary"
                >
                  Clear
                </button>
              )}
            </div>
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
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleId(p.id)}
                      aria-pressed={checked}
                      title={p.display_name ? p.id : undefined}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        checked
                          ? 'bg-accent border-accent text-white'
                          : 'border-border text-text-primary hover:bg-card-hover'
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
                usable on narrow phones with many portfolios selected. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 bg-card text-left font-semibold text-text-secondary text-xs px-4 py-2 min-w-[72px]">
                      Ticker
                    </th>
                    {allocMaps.map((p) => {
                      const active = sortById === p.id;
                      return (
                        <th
                          key={p.id}
                          aria-sort={active ? 'descending' : 'none'}
                          className="text-left font-semibold text-xs px-3 py-2 min-w-[150px]"
                        >
                          <button
                            onClick={() => setSortById(active ? null : p.id)}
                            title={active ? 'Reset to default sort' : 'Sort by this portfolio'}
                            className={`inline-flex items-center gap-1 max-w-[110px] hover:text-accent transition-colors ${
                              active ? 'text-accent' : 'text-text-primary'
                            }`}
                          >
                            <span className="truncate">{(p.displayName || p.id).toUpperCase()}</span>
                            {active && <ArrowDown className="w-3 h-3 shrink-0" />}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.ticker}>
                      <td className="sticky left-0 bg-card px-4 py-2">
                        {staticNames.has(row.ticker) ? (
                          <span className="font-mono font-medium text-text-primary">{row.ticker}</span>
                        ) : (
                        <button
                          onClick={() => openTickerView(row.ticker)}
                          title={`See ${row.ticker} across all portfolios`}
                          className="font-mono font-medium text-text-primary hover:text-accent transition-colors text-left"
                        >
                          {row.ticker}
                        </button>
                        )}
                      </td>
                      {row.pcts.map((pct, i) => (
                        <td key={allocMaps[i].id} className="px-3 py-1.5 min-w-[150px]">
                          {pct === null || pct <= 0 ? (
                            <span className="text-xs text-text-secondary/50">—</span>
                          ) : (
                            <AllocationBar percent={pct} maxPercent={tableMax} />
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
          </section>
        )}
        </>
        )}
      </main>

      {footerUpdated && (
        <Footer lastUpdated={footerUpdated} />
      )}
    </div>
  );
}
