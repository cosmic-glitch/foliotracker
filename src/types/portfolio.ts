export interface Holding {
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
}

export interface HistoricalDataPoint {
  date: string;
  value: number;
}

export interface BenchmarkHistoryPoint {
  date: string;
  percentChange: number;
}

export interface BenchmarkData {
  ticker: string;
  name: string;
  dayChangePercent: number;
}

export type MarketStatus = 'open' | 'pre-market' | 'after-hours' | 'closed';

export interface PortfolioData {
  portfolioId: string;
  displayName: string | null;
  totalValue: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  totalGain: number | null;
  totalGainPercent: number | null;
  holdings: Holding[];
  historicalData: HistoricalDataPoint[];
  benchmarkHistory: BenchmarkHistoryPoint[];
  lastUpdated: Date;
  marketStatus: MarketStatus;
  benchmark: BenchmarkData | null;
}

export interface HoldingConfig {
  ticker: string;
  name: string;
  shares: number;
  isStatic: boolean;
  staticValue?: number;
}
