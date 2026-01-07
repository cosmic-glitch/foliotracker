import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioData, MarketStatus, BenchmarkData, HistoricalDataPoint, BenchmarkHistoryPoint } from '../types/portfolio';
import { isMarketOpen } from '../lib/market-hours';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ApiHistoryResponse {
  data: HistoricalDataPoint[];
  benchmark: BenchmarkHistoryPoint[];
  lastUpdated: string;
}

interface ApiPortfolioResponse {
  portfolioId: string;
  displayName: string | null;
  totalValue: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  holdings: Array<{
    ticker: string;
    name: string;
    shares: number;
    currentPrice: number;
    previousClose: number;
    value: number;
    allocation: number;
    dayChange: number;
    dayChangePercent: number;
    isStatic: boolean;
    instrumentType: string;
  }>;
  lastUpdated: string;
  marketStatus: MarketStatus;
  benchmark: BenchmarkData | null;
}

// Query key factories for cache management
export const portfolioKeys = {
  all: ['portfolios'] as const,
  detail: (id: string) => ['portfolio', id] as const,
  history: (id: string) => ['portfolio', id, 'history'] as const,
};

// Fetch functions with HTTP cache support
async function fetchPortfolioApi(portfolioId: string): Promise<ApiPortfolioResponse | null> {
  const response = await fetch(
    `${API_BASE_URL}/api/portfolio?id=${encodeURIComponent(portfolioId)}`,
    { cache: 'default' } // Leverage browser HTTP cache
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Failed to fetch portfolio');
  return response.json();
}

async function fetchHistoryApi(portfolioId: string, days: number): Promise<ApiHistoryResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/history?id=${encodeURIComponent(portfolioId)}&days=${days}`,
    { cache: 'default' } // Leverage browser HTTP cache (24hr for history)
  );
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

export type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y';

export const TIME_RANGE_DAYS: Record<TimeRange, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '2Y': 730,
  '3Y': 1095,
};

const MAX_DAYS = 1095; // Always fetch 3Y, filter client-side

export function usePortfolioData(portfolioId: string) {
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState<TimeRange>('2Y');

  // Portfolio query - needs frequent updates for live prices
  const portfolioQuery = useQuery({
    queryKey: portfolioKeys.detail(portfolioId),
    queryFn: () => fetchPortfolioApi(portfolioId),
    enabled: !!portfolioId,
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    // Smart auto-refresh: 5 min when market open, 30 min when closed
    refetchInterval: () => isMarketOpen() ? 5 * 60 * 1000 : 30 * 60 * 1000,
  });

  // History query - very stable, rarely needs refresh
  const historyQuery = useQuery({
    queryKey: portfolioKeys.history(portfolioId),
    queryFn: () => fetchHistoryApi(portfolioId, MAX_DAYS),
    enabled: !!portfolioId && !!portfolioQuery.data, // Load after portfolio
    staleTime: 24 * 60 * 60 * 1000, // Fresh for 24 hours
    gcTime: 7 * 24 * 60 * 60 * 1000, // Keep in cache for 7 days
    refetchOnMount: false, // Don't refetch on every mount
    refetchOnWindowFocus: false,
    refetchInterval: false, // No auto-refresh for history
  });

  // Combine portfolio and history data
  const data: PortfolioData | null = useMemo(() => {
    if (!portfolioQuery.data) return null;
    const p = portfolioQuery.data;
    return {
      portfolioId: p.portfolioId,
      displayName: p.displayName,
      totalValue: p.totalValue,
      totalDayChange: p.totalDayChange,
      totalDayChangePercent: p.totalDayChangePercent,
      holdings: p.holdings,
      historicalData: historyQuery.data?.data || [],
      benchmarkHistory: historyQuery.data?.benchmark || [],
      lastUpdated: new Date(p.lastUpdated),
      marketStatus: p.marketStatus,
      benchmark: p.benchmark,
    };
  }, [portfolioQuery.data, historyQuery.data]);

  // Refresh only portfolio prices (not history - it rarely changes)
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) });
  }, [queryClient, portfolioId]);

  // Explicit history refresh (for when user really wants fresh chart data)
  const refreshHistory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: portfolioKeys.history(portfolioId) });
  }, [queryClient, portfolioId]);

  // Change time range (no refetch needed - filtering is client-side)
  const changeTimeRange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  return {
    data,
    isLoading: portfolioQuery.isLoading,
    isHistoryLoading: historyQuery.isLoading,
    isRefreshing: portfolioQuery.isFetching && !portfolioQuery.isLoading,
    error: portfolioQuery.error?.message || (portfolioQuery.data === null ? 'Portfolio not found' : null),
    timeRange,
    changeTimeRange,
    refresh,
    refreshHistory,
  };
}
