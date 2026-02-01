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

export type AIPersona = 'hot-take' | 'buffett' | 'munger';

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
  hotTake: string | null;
  hotTakeAt: string | null;
  buffettComment: string | null;
  buffettCommentAt: string | null;
  mungerComment: string | null;
  mungerCommentAt: string | null;
}

export interface HoldingConfig {
  ticker: string;
  name: string;
  shares: number;
  isStatic: boolean;
  staticValue?: number;
}

export interface TradeableHoldingInput {
  ticker: string;
  shares: number;
  costBasisPerShare?: number;
}

export interface StaticHoldingInput {
  name: string;
  value: number;
}

export interface HoldingsInput {
  tradeable: TradeableHoldingInput[];
  static: StaticHoldingInput[];
}
