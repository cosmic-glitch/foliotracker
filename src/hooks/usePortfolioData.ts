import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioData, MarketStatus, BenchmarkData, HistoricalDataPoint, BenchmarkHistoryPoint } from '../types/portfolio';
import { isMarketOpen } from '../lib/market-hours';

export type ChartView = '1D' | '30D';

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
  totalGain: number | null;
  totalGainPercent: number | null;
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
    costBasis: number | null;
    profitLoss: number | null;
    profitLossPercent: number | null;
  }>;
  lastUpdated: string;
  marketStatus: MarketStatus;
  benchmark: BenchmarkData | null;
  hotTake: string | null;
  hotTakeAt: string | null;
  buffettComment: string | null;
  buffettCommentAt: string | null;
  mungerComment: string | null;
  mungerCommentAt: string | null;
}

interface PrivatePortfolioResponse {
  portfolioId: string;
  displayName: string | null;
  isPrivate: boolean;
  visibility: 'public' | 'private' | 'selective';
  requiresAuth: true;
}

// Query key factories for cache management
export const portfolioKeys = {
  all: ['portfolios'] as const,
  detail: (id: string) => ['portfolio', id] as const,
  history: (id: string) => ['portfolio', id, 'history'] as const,
  intraday: (id: string) => ['portfolio', id, 'intraday'] as const,
};

// Fetch functions with HTTP cache support
async function fetchPortfolioApi(
  portfolioId: string,
  password?: string | null,
  loggedInAs?: string | null
): Promise<ApiPortfolioResponse | PrivatePortfolioResponse | null> {
  const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  if (password) {
    url.searchParams.set('password', password);
  }
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Invalid password');
  if (!response.ok) throw new Error('Failed to fetch portfolio');
  return response.json();
}

async function fetchHistoryApi(
  portfolioId: string,
  days: number,
  password?: string | null,
  loggedInAs?: string | null
): Promise<ApiHistoryResponse> {
  // Don't use browser HTTP cache - history depends on current holdings which can change
  const url = new URL(`${API_BASE_URL}/api/history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  url.searchParams.set('days', days.toString());
  if (password) {
    url.searchParams.set('password', password);
  }
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

async function fetchIntradayApi(
  portfolioId: string,
  password?: string | null,
  loggedInAs?: string | null
): Promise<ApiHistoryResponse> {
  const url = new URL(`${API_BASE_URL}/api/history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  url.searchParams.set('interval', '1m');
  if (password) {
    url.searchParams.set('password', password);
  }
  if (loggedInAs) {
    url.searchParams.set('logged_in_as', loggedInAs);
  }
  const response = await fetch(url.toString(), { cache: 'no-store' }); // Always fetch fresh for intraday
  if (!response.ok) throw new Error('Failed to fetch intraday data');
  return response.json();
}

const MAX_DAYS = 30; // Fetch 30 days of history

export function usePortfolioData(portfolioId: string, password?: string | null, loggedInAs?: string | null) {
  const queryClient = useQueryClient();
  const [chartView, setChartView] = useState<ChartView>('1D');

  // Portfolio query - needs frequent updates for live prices
  // Include password and loggedInAs in queryKey so it refetches when they change
  const portfolioQuery = useQuery({
    queryKey: [...portfolioKeys.detail(portfolioId), password ?? 'no-auth', loggedInAs ?? 'no-login'],
    queryFn: () => fetchPortfolioApi(portfolioId, password, loggedInAs),
    enabled: !!portfolioId,
    staleTime: 60 * 1000, // Fresh for 1 minute
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    // Smart auto-refresh: 1 min when market open, 30 min when closed
    refetchInterval: () => isMarketOpen() ? 60 * 1000 : 30 * 60 * 1000,
    refetchIntervalInBackground: true,
  });

  // History query (30D) - refetch when switching to this view
  // Include auth params in queryKey so it refetches when they change
  const historyQuery = useQuery({
    queryKey: [...portfolioKeys.history(portfolioId), password ?? 'no-auth', loggedInAs ?? 'no-login'],
    queryFn: () => fetchHistoryApi(portfolioId, MAX_DAYS, password, loggedInAs),
    enabled: !!portfolioId && !!portfolioQuery.data && chartView === '30D',
    staleTime: 5 * 60 * 1000, // Fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  // Intraday query - always fetched when market is open (used as ground truth for total value)
  // Include auth params in queryKey so it refetches when they change
  const intradayQuery = useQuery({
    queryKey: [...portfolioKeys.intraday(portfolioId), password ?? 'no-auth', loggedInAs ?? 'no-login'],
    queryFn: () => fetchIntradayApi(portfolioId, password, loggedInAs),
    // Fetch when viewing 1D OR when market is open (for accurate total value)
    enabled: !!portfolioId && !!portfolioQuery.data && (chartView === '1D' || isMarketOpen()),
    staleTime: 0, // Always stale - fetch fresh
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    // Auto-refresh every 1 minute when market is open
    refetchInterval: () => isMarketOpen() ? 60 * 1000 : false,
  });

  // Check if response is a private portfolio requiring auth
  const requiresAuth = useMemo(() => {
    if (!portfolioQuery.data) return false;
    return 'requiresAuth' in portfolioQuery.data && portfolioQuery.data.requiresAuth === true;
  }, [portfolioQuery.data]);

  // Get display name for private portfolios
  const privateDisplayName = useMemo(() => {
    if (!portfolioQuery.data) return null;
    if ('requiresAuth' in portfolioQuery.data) {
      return portfolioQuery.data.displayName;
    }
    return null;
  }, [portfolioQuery.data]);

  // Get the current chart data based on view
  const chartData = useMemo(() => {
    if (chartView === '1D') {
      return intradayQuery.data?.data || [];
    }
    // 30D uses history data
    return historyQuery.data?.data || [];
  }, [chartView, intradayQuery.data, historyQuery.data]);

  // Combine portfolio and chart data
  const data: PortfolioData | null = useMemo(() => {
    if (!portfolioQuery.data) return null;
    // If it's a private portfolio requiring auth, return null for data
    if ('requiresAuth' in portfolioQuery.data) return null;
    const p = portfolioQuery.data;

    // When market is open and we have intraday data, use it as ground truth
    // This ensures consistent total when switching between 1D/30D views
    const intradayData = intradayQuery.data?.data || [];
    let displayTotalValue = p.totalValue;
    if (p.marketStatus === 'open' && intradayData.length > 0) {
      displayTotalValue = intradayData[intradayData.length - 1].value;
    }

    return {
      portfolioId: p.portfolioId,
      displayName: p.displayName,
      totalValue: displayTotalValue,
      totalDayChange: p.totalDayChange,
      totalDayChangePercent: p.totalDayChangePercent,
      totalGain: p.totalGain,
      totalGainPercent: p.totalGainPercent,
      holdings: p.holdings,
      historicalData: chartData,
      benchmarkHistory: historyQuery.data?.benchmark || [],
      lastUpdated: new Date(p.lastUpdated),
      marketStatus: p.marketStatus,
      benchmark: p.benchmark,
      hotTake: p.hotTake,
      hotTakeAt: p.hotTakeAt,
      buffettComment: p.buffettComment,
      buffettCommentAt: p.buffettCommentAt,
      mungerComment: p.mungerComment,
      mungerCommentAt: p.mungerCommentAt,
    };
  }, [portfolioQuery.data, chartData, historyQuery.data?.benchmark, intradayQuery.data]);

  // Refresh only portfolio prices (not history - it rarely changes)
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) });
  }, [queryClient, portfolioId]);

  // Explicit history refresh (for when user really wants fresh chart data)
  const refreshHistory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: portfolioKeys.history(portfolioId) });
  }, [queryClient, portfolioId]);

  // Chart loading state depends on current view
  const isChartLoading = chartView === '1D'
    ? intradayQuery.isLoading
    : historyQuery.isLoading;

  return {
    data,
    isLoading: portfolioQuery.isLoading,
    isHistoryLoading: isChartLoading,
    isRefreshing: portfolioQuery.isFetching && !portfolioQuery.isLoading,
    error: portfolioQuery.error?.message || (portfolioQuery.data === null ? 'Portfolio not found' : null),
    requiresAuth,
    privateDisplayName,
    chartView,
    setChartView,
    refresh,
    refreshHistory,
  };
}
