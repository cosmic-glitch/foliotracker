import { useQueries } from '@tanstack/react-query';
import { isLiveMarketSession } from '../lib/market-hours';
import { fetchTickerChart } from './useTickerHistory';
import type { ChartView } from './usePortfolioData';

// Funds every portfolio's 1D and 30D charts overlay by % move. Order sets
// each fund's color slot (BENCHMARK_COLORS in PerformanceChart).
export const BENCHMARK_SYMBOLS = ['VOO', 'QQQ'];

export interface BenchmarkPoint {
  t: number; // epoch ms, on the same clock as the chart's x axis
  close: number;
}

export interface BenchmarkSeries {
  symbol: string;
  points: BenchmarkPoint[];
  // 1D only: the prior session's close the day's move is measured from. The
  // 30D chart rebases to the fund's close on its own first day instead.
  previousClose: number | null;
}

// /api/ticker's 1D range is 5-minute bars stamped at the bar's start, while
// the close is the price at its end — re-stamp to the end (capped at now for
// the in-progress bar) so a sharp move lines up with the portfolio's 1-minute
// series instead of leading it by up to 5 minutes.
const BAR_MS = 5 * 60 * 1000;

// 30D fetches 6mo of daily closes rather than 1mo: Yahoo's month and the
// chart's 30-calendar-day window disagree by a day or two at month ends, and
// the fund needs a close on or before the chart's first day to rebase on.
// Daily points are stamped at local midnight, matching PerformanceChart's 30D
// timestamps (and today's bar, present while the session runs, carries the
// live price).
//
// Shares the ['ticker-history', symbol, range] cache with the ticker detail
// panel.
export function useBenchmarkSeries(symbols: string[], chartView: ChartView, enabled: boolean): BenchmarkSeries[] {
  const range = chartView === '1D' ? '1d' : '6mo';
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['ticker-history', symbol, range],
      queryFn: () => fetchTickerChart(symbol, range),
      enabled,
      staleTime: (range === '1d' ? 1 : 5) * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: () => (isLiveMarketSession() ? (range === '1d' ? 1 : 5) * 60 * 1000 : false as const),
    })),
    combine: (results) => {
      const now = Date.now();
      const out: BenchmarkSeries[] = [];
      for (const { data: chart } of results) {
        if (!chart || chart.points.length === 0) continue;
        if (range === '1d') {
          if (!chart.previousClose || chart.previousClose <= 0) continue;
          out.push({
            symbol: chart.symbol,
            previousClose: chart.previousClose,
            points: chart.points.map((p) => ({
              t: Math.min(new Date(p.date).getTime() + BAR_MS, now),
              close: p.close,
            })),
          });
        } else {
          out.push({
            symbol: chart.symbol,
            previousClose: null,
            points: chart.points.map((p) => {
              const [year, month, day] = p.date.split('-').map(Number);
              return { t: new Date(year, month - 1, day).getTime(), close: p.close };
            }),
          });
        }
      }
      return out;
    },
  });
}
