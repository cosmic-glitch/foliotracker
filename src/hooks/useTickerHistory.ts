import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export type TickerRange = '1d' | '1mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';

export const TICKER_RANGES: { value: TickerRange; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '1mo', label: '1M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '5y', label: '5Y' },
  { value: 'max', label: 'Max' },
];

export interface TickerChartPoint {
  date: string; // YYYY-MM-DD, or a full ISO timestamp for the intraday (1d) range
  close: number;
}

export interface TickerChart {
  symbol: string;
  range: TickerRange;
  name: string | null;
  currency: string | null;
  points: TickerChartPoint[];
  // Intraday only (null otherwise): the session bounds (`start`/`end` regular,
  // `preStart`/`postEnd` extended — equal to the regular ones when the
  // instrument has no extended tape) and the prior close the day change is
  // measured from. Points always include pre/post bars.
  previousClose: number | null;
  session: { preStart: string; start: string; end: string; postEnd: string } | null;
}

async function fetchTickerChart(symbol: string, range: TickerRange): Promise<TickerChart> {
  const url = new URL(`${API_BASE_URL}/api/ticker`, window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('range', range);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to fetch price history');
  }
  return response.json();
}

// Raw price series for one ticker, fetched straight from Yahoo via
// /api/ticker on demand. Nothing is cached server-side; React Query keeps
// each symbol+range pair for the session so range-flipping is instant after
// the first load. Intraday goes stale sooner so reopening a ticker during the
// session picks up the newest bars.
export function useTickerHistory(symbol: string | null, range: TickerRange) {
  return useQuery({
    queryKey: ['ticker-history', symbol, range],
    queryFn: () => fetchTickerChart(symbol!, range),
    enabled: !!symbol,
    staleTime: (range === '1d' ? 1 : 5) * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
