import { createContext, useContext, useState, type ReactNode } from 'react';
import { BENCHMARK_SYMBOL_RE, DEFAULT_BENCHMARKS, MAX_BENCHMARKS, type BenchmarkSlots } from '../lib/benchmarks';

// Viewer's pick of benchmark funds (slots + colors in lib/benchmarks.ts),
// persisted per browser.

const STORAGE_KEY = 'foliotracker-benchmarks';

function readStored(): BenchmarkSlots {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BENCHMARKS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== MAX_BENCHMARKS) return DEFAULT_BENCHMARKS;
    const seen = new Set<string>();
    return parsed.map((s) => {
      if (typeof s !== 'string' || !BENCHMARK_SYMBOL_RE.test(s) || seen.has(s)) return null;
      seen.add(s);
      return s;
    });
  } catch {
    return DEFAULT_BENCHMARKS;
  }
}

interface BenchmarksContextType {
  slots: BenchmarkSlots;
  addBenchmark: (symbol: string) => void;
  removeBenchmark: (symbol: string) => void;
  resetBenchmarks: () => void;
}

const BenchmarksContext = createContext<BenchmarksContextType | undefined>(undefined);

export function BenchmarksProvider({ children }: { children: ReactNode }) {
  // Lazy initializer, not a post-mount effect: the first render must already
  // reflect the stored pick (see CLAUDE.md on storage-backed hooks).
  const [slots, setSlots] = useState<BenchmarkSlots>(readStored);

  const update = (fn: (prev: BenchmarkSlots) => BenchmarkSlots) => {
    setSlots((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* storage unavailable — keep the in-memory pick */ }
      return next;
    });
  };

  const addBenchmark = (symbol: string) => update((prev) => {
    const free = prev.indexOf(null);
    if (free === -1 || prev.includes(symbol)) return prev;
    return prev.map((s, i) => (i === free ? symbol : s));
  });

  const removeBenchmark = (symbol: string) => update((prev) => prev.map((s) => (s === symbol ? null : s)));

  const resetBenchmarks = () => update(() => DEFAULT_BENCHMARKS);

  return (
    <BenchmarksContext.Provider value={{ slots, addBenchmark, removeBenchmark, resetBenchmarks }}>
      {children}
    </BenchmarksContext.Provider>
  );
}

export function useBenchmarks() {
  const context = useContext(BenchmarksContext);
  if (!context) {
    throw new Error('useBenchmarks must be used within a BenchmarksProvider');
  }
  return context;
}
