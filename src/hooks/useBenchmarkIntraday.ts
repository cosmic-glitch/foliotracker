import { useQueries } from '@tanstack/react-query';
import { isLiveMarketSession } from '../lib/market-hours';
import { fetchTickerChart } from './useTickerHistory';

// Benchmark-overlay pilot: portfolios whose 1D chart also plots these funds'
// % move. Delete this map (and the overlay) or widen it once the pilot is
// decided.
export const BENCHMARK_PILOT: Record<string, string[]> = {
  av: ['VOO', 'VGT'],
};

export interface BenchmarkPoint {
  t: number; // epoch ms
  pct: number; // fraction vs previous close (0.01 = +1%)
}

export interface BenchmarkSeries {
  symbol: string;
  points: BenchmarkPoint[];
}

// /api/ticker's 1D range is 5-minute bars stamped at the bar's start, while
// the close is the price at its end — re-stamp to the end (capped at now for
// the in-progress bar) so a sharp move lines up with the portfolio's 1-minute
// series instead of leading it by up to 5 minutes.
const BAR_MS = 5 * 60 * 1000;

// Shares the ['ticker-history', symbol, '1d'] cache with the ticker detail
// panel.
export function useBenchmarkIntraday(symbols: string[], enabled: boolean): BenchmarkSeries[] {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['ticker-history', symbol, '1d'],
      queryFn: () => fetchTickerChart(symbol, '1d'),
      enabled,
      staleTime: 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: () => (isLiveMarketSession() ? 60 * 1000 : false as const),
    })),
    combine: (results) => {
      const now = Date.now();
      const out: BenchmarkSeries[] = [];
      for (const { data: chart } of results) {
        if (!chart?.previousClose || chart.previousClose <= 0) continue;
        const prev = chart.previousClose;
        out.push({
          symbol: chart.symbol,
          points: chart.points.map((p) => ({
            t: Math.min(new Date(p.date).getTime() + BAR_MS, now),
            pct: p.close / prev - 1,
          })),
        });
      }
      return out;
    },
  });
}
