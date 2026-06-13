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
  // Per-holding 30D figures. Null for tickers that lack historical data yet
  // (brand-new addition) — HoldingsTable renders these as empty cells when
  // the global timeframe is set to 30d. Static holdings: 0/0/null.
  thirtyDayChange: number | null;
  thirtyDayChangePercent: number | null;
  thirtyDayAnchorPrice: number | null;
  isStatic: boolean;
  instrumentType: string;
  costBasis: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
  revenue: number | null;
  earnings: number | null;
  forwardPE: number | null;
  pctTo52WeekHigh: number | null;
  week52High: number | null;
  operatingMargin: number | null;
  revenueGrowth3Y: number | null;
  epsGrowth3Y: number | null;
  regularMarketPrice: number;
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
  // 30D headline change against the oldest point in the active 30D series.
  // Null while the 30D history is loading or when no anchor is available
  // (brand-new portfolio with no historical data). Mirrors the per-portfolio
  // figures the landing-page list endpoint computes off `history_30d_json[0]`.
  totalThirtyDayChange: number | null;
  totalThirtyDayChangePercent: number | null;
  totalGain: number | null;
  totalGainPercent: number | null;
  holdings: Holding[];
  historicalData: HistoricalDataPoint[];
  benchmarkHistory: BenchmarkHistoryPoint[];
  lastUpdated: Date;
  marketStatus: MarketStatus;
  benchmark: BenchmarkData | null;
  deepResearch: string | null;
  deepResearchAt: string | null;
  staleTickers: string[];
  // Set when viewing through an `allocation_only` share link OR when the
  // viewer is restricted (private/selective + not the owner) on a portfolio
  // whose owner has `allocation_public = TRUE`. In that mode the API zeroes
  // out all dollar-denominated fields on holdings (value, shares, dayChange,
  // costBasis, profitLoss, week52High, etc.) and the historical series is
  // normalized so the first point is 100.
  viewMode?: 'full' | 'allocation_only';
  // Distinguishes the two paths above so the banner picks the right copy.
  viewSource?: 'share_link' | 'restricted';
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
