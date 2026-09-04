import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export type TickerRange = '1mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';

export const TICKER_RANGES: { value: TickerRange; label: string }[] = [
  { value: '1mo', label: '1M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '5y', label: '5Y' },
  { value: 'max', label: 'Max' },
];

export interface TickerChartPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface TickerChart {
  symbol: string;
  range: TickerRange;
  name: string | null;
  currency: string | null;
  points: TickerChartPoint[];
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
// the first load.
export function useTickerHistory(symbol: string | null, range: TickerRange) {
  return useQuery({
    queryKey: ['ticker-history', symbol, range],
    queryFn: () => fetchTickerChart(symbol!, range),
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
