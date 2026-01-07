import { useState, useEffect, useCallback } from 'react';
import type { PortfolioData, MarketStatus, BenchmarkData, HistoricalDataPoint, BenchmarkHistoryPoint } from '../types/portfolio';

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

async function fetchPortfolio(portfolioId: string): Promise<ApiPortfolioResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/portfolio?id=${encodeURIComponent(portfolioId)}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) throw new Error('Failed to fetch portfolio');
    return await response.json();
  } catch (error) {
    console.warn('Could not fetch from API:', error);
    return null;
  }
}

async function fetchHistory(portfolioId: string, days: number = 30): Promise<ApiHistoryResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/history?id=${encodeURIComponent(portfolioId)}&days=${days}`);
    if (!response.ok) throw new Error('Failed to fetch history');
    return await response.json();
  } catch (error) {
    console.warn('Could not fetch history:', error);
    return null;
  }
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
  const [data, setData] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('2Y');

  // Fetch portfolio data (fast - just current prices)
  const fetchPortfolioData = useCallback(async (showRefreshState = false) => {
    if (!portfolioId) {
      setIsLoading(false);
      setError('No portfolio ID provided');
      return;
    }

    if (showRefreshState) {
      setIsRefreshing(true);
    }

    try {
      const portfolioResponse = await fetchPortfolio(portfolioId);

      if (portfolioResponse) {
        setData((prev) => ({
          portfolioId: portfolioResponse.portfolioId,
          displayName: portfolioResponse.displayName,
          totalValue: portfolioResponse.totalValue,
          totalDayChange: portfolioResponse.totalDayChange,
          totalDayChangePercent: portfolioResponse.totalDayChangePercent,
          holdings: portfolioResponse.holdings,
          historicalData: prev?.historicalData || [],
          benchmarkHistory: prev?.benchmarkHistory || [],
          lastUpdated: new Date(portfolioResponse.lastUpdated),
          marketStatus: portfolioResponse.marketStatus,
          benchmark: portfolioResponse.benchmark,
        }));
        setError(null);
      } else {
        setData(null);
        setError('Portfolio not found');
      }
    } catch (err) {
      console.error('Error fetching portfolio data:', err);
      setData(null);
      setError('Failed to load portfolio');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [portfolioId]);

  // Fetch historical data (slow - fetches from Yahoo Finance)
  // Always fetch max range (2Y), filtering happens client-side
  const fetchHistoricalData = useCallback(async () => {
    if (!portfolioId) return;

    setIsHistoryLoading(true);
    try {
      const historyResponse = await fetchHistory(portfolioId, MAX_DAYS);
      if (historyResponse) {
        setData((prev) => prev ? {
          ...prev,
          historicalData: historyResponse.data,
          benchmarkHistory: historyResponse.benchmark,
        } : null);
      }
    } catch (err) {
      console.error('Error fetching historical data:', err);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [portfolioId]);

  // Initial load - fetch portfolio first, then history
  useEffect(() => {
    setIsLoading(true);
    setIsHistoryLoading(true);
    setData(null);
    setError(null);
    fetchPortfolioData();
  }, [fetchPortfolioData]);

  // Fetch history after portfolio loads (lazy load)
  useEffect(() => {
    if (data && !isLoading && data.historicalData.length === 0) {
      fetchHistoricalData();
    }
  }, [data?.portfolioId, isLoading, fetchHistoricalData]);

  // Change time range (no refetch needed - filtering is client-side)
  const changeTimeRange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  // Auto-refresh portfolio every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPortfolioData(false);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchPortfolioData]);

  const refresh = useCallback(() => {
    fetchPortfolioData(true);
    fetchHistoricalData();
  }, [fetchPortfolioData, fetchHistoricalData]);

  return {
    data,
    isLoading,
    isHistoryLoading,
    isRefreshing,
    error,
    timeRange,
    changeTimeRange,
    refresh,
  };
}
