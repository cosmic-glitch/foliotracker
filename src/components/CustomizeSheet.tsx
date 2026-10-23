import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, SlidersHorizontal, Loader2, Plus, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useBenchmarks } from '../context/BenchmarksContext';
import { BENCHMARK_COLORS, BENCHMARK_SYMBOL_RE, DEFAULT_BENCHMARKS, MAX_BENCHMARKS } from '../lib/benchmarks';
import { fetchTickerChart } from '../hooks/useTickerHistory';

// Set-and-forget view preferences, opened from UserMenu's "Customize…" row.
// Extended Hours and 30-Day View deliberately stay as one-tap menu rows —
// they get flipped often (e.g. extended hours on after the close).
// Bottom sheet on mobile, centered card on desktop; portaled to <body> so the
// header's stacking context can't clip the fixed overlay.

const PRESETS: { symbol: string; name: string }[] = [
  { symbol: 'VOO', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq-100' },
  { symbol: 'VTI', name: 'Total US' },
  { symbol: 'DIA', name: 'Dow 30' },
  { symbol: 'IWM', name: 'Russell 2000' },
  { symbol: 'VXUS', name: 'International' },
  { symbol: 'AGG', name: 'US Bonds' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
];

export function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const { slots, addBenchmark, removeBenchmark, resetBenchmarks } = useBenchmarks();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const picked = slots.flatMap((symbol, slot) => (symbol ? [{ symbol, slot }] : []));
  const full = picked.length >= MAX_BENCHMARKS;
  const isDefault = slots.every((s, i) => s === DEFAULT_BENCHMARKS[i]);

  // Free-form tickers are checked against /api/ticker before they're saved,
  // so a typo never leaves a silently-missing line. The fetch lands in the
  // same ['ticker-history', symbol, '1d'] cache the 1D overlay reads.
  const handleAdd = async () => {
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    if (!BENCHMARK_SYMBOL_RE.test(symbol)) {
      setError('Not a valid ticker');
      return;
    }
    if (slots.includes(symbol)) {
      setError(`${symbol} is already on the chart`);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const chart = await queryClient.fetchQuery({
        queryKey: ['ticker-history', symbol, '1d'],
        queryFn: () => fetchTickerChart(symbol, '1d'),
        staleTime: 60 * 1000,
        retry: false, // a 404 is the answer, not a transient failure
      });
      if (chart.points.length === 0) throw new Error('empty');
      addBenchmark(symbol);
      setInput('');
    } catch {
      setError(`No price data for ${symbol}`);
    } finally {
      setChecking(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[85dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customize-title"
      >
        <div className="flex items-start justify-between mb-4">
          <h3 id="customize-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-text-secondary" />
            Customize
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-card-hover rounded-lg transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <h4 className="text-sm font-semibold text-text-primary">Benchmarks</h4>
            {!isDefault && (
              <button onClick={resetBenchmarks} className="text-xs text-accent hover:underline">
                Reset to default
              </button>
            )}
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Compared by % move on the 1D and 30D charts. Up to {MAX_BENCHMARKS}.
          </p>

          <div className="flex flex-wrap gap-2 mb-4 min-h-[2rem]">
            {picked.length === 0 ? (
              <span className="text-sm text-text-secondary self-center">None — the chart shows your portfolio alone.</span>
            ) : (
              picked.map(({ symbol, slot }) => (
                <span
                  key={symbol}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border border-border bg-background text-sm text-text-primary"
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BENCHMARK_COLORS[slot] }} />
                  {symbol}
                  <button
                    onClick={() => removeBenchmark(symbol)}
                    className="p-0.5 rounded-full hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors"
                    aria-label={`Remove ${symbol}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))
            )}
          </div>

          <div className="text-xs text-text-secondary mb-2">
            {full ? 'Remove one to add another.' : 'Add'}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {PRESETS.map(({ symbol, name }) => {
              const selected = slots.includes(symbol);
              return (
                <button
                  key={symbol}
                  onClick={() => addBenchmark(symbol)}
                  disabled={selected || full}
                  className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border text-left transition-colors enabled:hover:bg-card-hover disabled:opacity-40"
                >
                  <span className="text-sm font-medium text-text-primary">{symbol}</span>
                  <span className="text-xs text-text-secondary truncate">{selected ? 'Added' : name}</span>
                </button>
              );
            })}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder="Any ticker, e.g. NVDA"
              disabled={full}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={full || checking || !input.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium transition-opacity disabled:opacity-40"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
          </form>
          {error && <p className="text-xs text-negative mt-1.5">{error}</p>}
        </section>

        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-2">Theme</h4>
          <div className="inline-flex rounded-lg border border-border bg-background overflow-hidden">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { if (theme !== t) toggleTheme(); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  theme === t ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
