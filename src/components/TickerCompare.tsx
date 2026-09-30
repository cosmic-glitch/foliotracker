import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { AllocationBar } from './AllocationBar';
import { canonicalTicker, consolidateHoldings } from '../utils/equivalentTickers';
import type { CompareResult } from '../hooks/useComparePortfolios';

// Widely-held tickers offered as one-tap chips under the search box.
const TOP_CHIPS = 12;
const MAX_SUGGESTIONS = 8;

interface TickerHolder {
  id: string;
  label: string;
  pct: number;
}

interface TickerEntry {
  ticker: string;
  name: string;
  holders: TickerHolder[];
  // Summed weight across holders — only a tie-breaker for chip ranking.
  totalPct: number;
}

interface TickerCompareProps {
  results: CompareResult[];
  failed: { id: string; message: string }[];
  loading: boolean;
  // Canonical upper-case ticker from the URL, or null when none is picked.
  ticker: string | null;
  onSelectTicker: (ticker: string | null) => void;
}

const labelOf = (r: CompareResult) => (r.displayName || r.id).toUpperCase();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// One ticker's weight across every portfolio the viewer can see. Only
// allocation % is read (never dollars), so allocation-only portfolios take
// part on equal footing and portfolio size stays out of the picture.
export function TickerCompare({ results, failed, loading, ticker, onSelectTicker }: TickerCompareProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const usable = useMemo(() => results.filter((r) => !r.inaccessible && !r.pending), [results]);
  const pending = useMemo(() => results.filter((r) => r.pending), [results]);

  // ticker → holders. Static rows (cash, property) aren't tickers and are
  // skipped; equivalent share classes collapse onto one canonical ticker,
  // across portfolios as well as within one.
  const index = useMemo(() => {
    const byTicker = new Map<string, TickerEntry>();
    for (const r of usable) {
      const weights = new Map<string, { pct: number; name: string }>();
      for (const h of consolidateHoldings(r.holdings)) {
        if (h.isStatic || h.allocation <= 0) continue;
        const t = canonicalTicker(h.ticker);
        const prev = weights.get(t);
        weights.set(t, { pct: (prev?.pct ?? 0) + h.allocation, name: prev?.name ?? h.name });
      }
      for (const [t, { pct, name }] of weights) {
        let entry = byTicker.get(t);
        if (!entry) {
          entry = { ticker: t, name, holders: [], totalPct: 0 };
          byTicker.set(t, entry);
        }
        entry.holders.push({ id: r.id, label: labelOf(r), pct });
        entry.totalPct += pct;
      }
    }
    return byTicker;
  }, [usable]);

  const ranked = useMemo(
    () =>
      [...index.values()].sort(
        (a, b) => b.holders.length - a.holders.length || b.totalPct - a.totalPct || a.ticker.localeCompare(b.ticker),
      ),
    [index],
  );

  const topChips = ranked.slice(0, TOP_CHIPS);

  // Exact ticker, then ticker prefix, then name substring; breadth breaks ties
  // (ranked is already breadth-ordered and the sort is stable).
  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const score = (e: TickerEntry) => {
      if (e.ticker === q) return 0;
      if (e.ticker.startsWith(q)) return 1;
      if (e.name.toUpperCase().includes(q)) return 2;
      return -1;
    };
    return ranked
      .map((e) => ({ e, s: score(e) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s)
      .slice(0, MAX_SUGGESTIONS)
      .map((x) => x.e);
  }, [query, ranked]);

  const select = (t: string) => {
    onSelectTicker(t);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const pick = suggestions[activeIdx];
      if (pick) select(pick.ticker);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const selected = ticker ? index.get(ticker) ?? null : null;
  const holders = selected ? [...selected.holders].sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label)) : [];
  const nonHolders = selected
    ? usable.filter((r) => !selected.holders.some((h) => h.id === r.id)).map((r) => ({ id: r.id, label: labelOf(r) }))
    : [];
  // One scale for every row, like the portfolios view: the largest weight
  // fills its track and the rest are proportional.
  const maxPct = Math.max(0, ...holders.map((h) => h.pct));
  const medianPct = holders.length ? median(holders.map((h) => h.pct)) : 0;

  const skipped = [
    ...failed.map((f) => f.id.toUpperCase()),
    ...pending.map((r) => labelOf(r)),
  ];

  return (
    <>
      <section aria-label="Select ticker" className="bg-card border border-border rounded-2xl">
        <div className="p-3 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActiveIdx(0);
              }}
              onFocus={() => setOpen(true)}
              // Delay so a click on a suggestion lands before the list unmounts.
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={onKeyDown}
              placeholder={loading ? 'Loading holdings…' : 'Search a ticker or company'}
              aria-label="Search ticker"
              role="combobox"
              aria-expanded={open && suggestions.length > 0}
              aria-controls="ticker-suggestions"
              autoComplete="off"
              spellCheck={false}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-background text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            {open && query.trim() !== '' && (
              <ul
                id="ticker-suggestions"
                role="listbox"
                className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
              >
                {suggestions.length === 0 ? (
                  <li className="px-3 py-2.5 text-sm text-text-secondary">
                    {loading ? 'Still loading portfolios…' : 'No portfolio you can see holds that.'}
                  </li>
                ) : (
                  suggestions.map((s, i) => (
                    <li key={s.ticker} role="option" aria-selected={i === activeIdx}>
                      <button
                        // mousedown, not click: fires before the input's blur.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          select(s.ticker);
                        }}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`w-full px-3 py-2 flex items-center gap-3 text-left text-sm ${
                          i === activeIdx ? 'bg-card-hover' : ''
                        }`}
                      >
                        <span className="font-mono font-medium text-text-primary w-16 shrink-0">{s.ticker}</span>
                        <span className="text-text-secondary truncate flex-1">{s.name}</span>
                        <span className="text-xs text-text-secondary shrink-0">
                          {s.holders.length} {s.holders.length === 1 ? 'portfolio' : 'portfolios'}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          {topChips.length > 0 && (
            <div>
              <div className="text-[11px] text-text-secondary mb-1.5">Most widely held</div>
              <div className="flex flex-wrap gap-2">
                {topChips.map((e) => {
                  const active = e.ticker === ticker;
                  return (
                    <button
                      key={e.ticker}
                      onClick={() => onSelectTicker(active ? null : e.ticker)}
                      aria-pressed={active}
                      title={e.name}
                      className={`px-2.5 py-1.5 rounded-lg border text-sm font-mono font-medium transition-colors flex items-center gap-1.5 ${
                        active
                          ? 'bg-accent border-accent text-white'
                          : 'border-border text-text-primary hover:bg-card-hover'
                      }`}
                    >
                      {e.ticker}
                      <span className={`text-[11px] font-sans ${active ? 'text-white/80' : 'text-text-secondary'}`}>
                        {e.holders.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {skipped.length > 0 && !loading && (
        <div className="bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-secondary">
          Not included (couldn't load or no snapshot yet): {skipped.join(', ')}.
        </div>
      )}

      {ticker && loading && !selected && (
        <div className="text-center text-sm text-text-secondary py-6">Loading portfolios…</div>
      )}

      {ticker && !loading && !selected && (
        <div className="bg-card border border-border rounded-2xl px-4 py-8 text-center text-sm text-text-secondary">
          No portfolio you can see holds <span className="font-mono text-text-primary">{ticker}</span>.
        </div>
      )}

      {selected && (
        <section aria-label={`${selected.ticker} across portfolios`} className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <h2 className="font-mono text-lg font-semibold text-text-primary">{selected.ticker}</h2>
                <span className="text-sm text-text-secondary truncate">{selected.name}</span>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">
                Held by <span className="font-semibold text-text-primary">{holders.length}</span> of {usable.length}{' '}
                {usable.length === 1 ? 'portfolio' : 'portfolios'}
                {holders.length > 1 && <> · median {medianPct.toFixed(1)}%</>}
                {loading && ' · loading more…'}
              </p>
            </div>
            <button
              onClick={() => onSelectTicker(null)}
              title="Clear ticker"
              className="p-1.5 -mr-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ul className="divide-y divide-border">
            {holders.map((h) => (
              <li key={h.id} className="grid grid-cols-[minmax(0,7rem)_1fr] sm:grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 px-4 py-2">
                <Link
                  to={`/${h.id}`}
                  title={h.id}
                  className="text-sm font-medium text-text-primary hover:text-accent truncate transition-colors"
                >
                  {h.label}
                </Link>
                <AllocationBar percent={h.pct} maxPercent={maxPct} />
              </li>
            ))}
          </ul>
          {nonHolders.length > 0 && (
            <p className="px-4 py-2.5 text-xs text-text-secondary border-t border-border">
              Not held by:{' '}
              {nonHolders.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link to={`/${p.id}`} className="hover:text-text-primary transition-colors">
                    {p.label}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <p className="px-4 py-2.5 text-[11px] text-text-secondary border-t border-border">
            Share of each portfolio's net worth. Bars share one scale. Equivalent share
            classes (GOOG/GOOGL) are combined.
          </p>
        </section>
      )}

      {!ticker && !loading && ranked.length === 0 && (
        <div className="text-center text-sm text-text-secondary py-6">
          No holdings to compare yet.
        </div>
      )}
    </>
  );
}
