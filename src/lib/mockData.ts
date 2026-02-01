import type { Holding, HistoricalDataPoint, BenchmarkHistoryPoint, PortfolioData } from '../types/portfolio';

// Prices as of Jan 3, 2026 (used for fallback/demo mode)
const mockPrices: Record<string, { current: number; previousClose: number }> = {
  VUG: { current: 486.20, previousClose: 487.86 },
  VGT: { current: 755.98, previousClose: 753.78 },
  NVDA: { current: 188.85, previousClose: 186.50 },
  META: { current: 650.41, previousClose: 660.09 },
  GOOG: { current: 315.32, previousClose: 313.80 },
  TSM: { current: 319.61, previousClose: 303.89 },
  VOO: { current: 628.30, previousClose: 627.13 },
};

// Portfolio holdings configuration (shares calculated from initial values)
// Values in thousands: VUG 4174.9, VGT 3323.3, NVDA 3110.2, META 2452.0, GOOG 1895.4
// Real Estate 1526.5, VWUAX 1499.2, TSM 893.0, VOO 605.4, VMFXX 187.3, Rest 94.8
// Share counts calculated from $ values as of Jan 3, 2026 close prices
const holdingsConfig = [
  { ticker: 'VUG', name: 'Vanguard Growth ETF', shares: 8587.21, isStatic: false },
  { ticker: 'VGT', name: 'Vanguard Info Tech ETF', shares: 4396.02, isStatic: false },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', shares: 16469.68, isStatic: false },
  { ticker: 'META', name: 'Meta Platforms', shares: 3770.00, isStatic: false },
  { ticker: 'GOOG', name: 'Alphabet Inc.', shares: 6011.33, isStatic: false },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', shares: 2793.94, isStatic: false },
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', shares: 963.55, isStatic: false },
  { ticker: 'VWUAX', name: 'Vanguard Growth Fund', shares: 1, isStatic: true, staticValue: 1499200 },
  { ticker: 'VMFXX', name: 'Vanguard Money Market', shares: 1, isStatic: true, staticValue: 187300 },
  { ticker: 'Real Estate', name: 'Real Estate', shares: 1, isStatic: true, staticValue: 1526500 },
  { ticker: 'Rest', name: 'Other Holdings', shares: 1, isStatic: true, staticValue: 94800 },
];

function calculateHoldings(): Holding[] {
  const holdings: Holding[] = holdingsConfig.map((config) => {
    if (config.isStatic) {
      // Determine instrument type for static holdings
      let instrumentType = 'Other';
      const lowerTicker = config.ticker.toLowerCase();
      if (lowerTicker.includes('real estate')) {
        instrumentType = 'Real Estate';
      } else if (lowerTicker === 'vmfxx' || lowerTicker.includes('money market')) {
        instrumentType = 'Cash';
      }

      return {
        ticker: config.ticker,
        name: config.name,
        shares: config.shares,
        currentPrice: config.staticValue!,
        previousClose: config.staticValue!,
        value: config.staticValue!,
        allocation: 0,
        dayChange: 0,
        dayChangePercent: 0,
        isStatic: true,
        instrumentType,
        costBasis: null,
        profitLoss: null,
        profitLossPercent: null,
      };
    }

    const prices = mockPrices[config.ticker];
    const value = config.shares * prices.current;
    const previousValue = config.shares * prices.previousClose;
    const dayChange = value - previousValue;
    const dayChangePercent = (dayChange / previousValue) * 100;

    // Determine instrument type for tradeable holdings
    let instrumentType = 'ETF'; // Default to ETF since most are ETFs
    if (['NVDA', 'META', 'GOOG', 'TSM'].includes(config.ticker)) {
      instrumentType = 'Common Stock';
    } else if (config.ticker === 'VWUAX') {
      instrumentType = 'Mutual Fund';
    }

    return {
      ticker: config.ticker,
      name: config.name,
      shares: config.shares,
      currentPrice: prices.current,
      previousClose: prices.previousClose,
      value,
      allocation: 0,
      dayChange,
      dayChangePercent,
      isStatic: false,
      instrumentType,
      costBasis: null,
      profitLoss: null,
      profitLossPercent: null,
    };
  });

  // Calculate total and allocations
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  holdings.forEach((h) => {
    h.allocation = (h.value / totalValue) * 100;
  });

  // Sort by value descending
  holdings.sort((a, b) => b.value - a.value);

  return holdings;
}

function generateHistoricalData(): { data: HistoricalDataPoint[]; benchmark: BenchmarkHistoryPoint[] } {
  const data: HistoricalDataPoint[] = [];
  const benchmark: BenchmarkHistoryPoint[] = [];
  const today = new Date();
  const baseValue = 19500000; // Starting value ~30 days ago

  for (let i = 30; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Simulate market movement with some volatility
    const dayIndex = 30 - i;
    const trend = dayIndex * 8500; // Slight upward trend
    const volatility = Math.sin(dayIndex * 0.5) * 150000 + Math.random() * 100000 - 50000;
    const value = baseValue + trend + volatility;

    const dateStr = date.toISOString().split('T')[0];

    data.push({
      date: dateStr,
      value: Math.round(value),
    });

    // Simulate SPY benchmark (slightly lower returns than portfolio)
    const spyTrend = dayIndex * 0.08; // ~2.4% over 30 days
    const spyVolatility = Math.sin(dayIndex * 0.4) * 0.5 + Math.random() * 0.3 - 0.15;
    benchmark.push({
      date: dateStr,
      percentChange: spyTrend + spyVolatility,
    });
  }

  return { data, benchmark };
}

export function getMockPortfolioData(): PortfolioData {
  const holdings = calculateHoldings();
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalDayChange = holdings.reduce((sum, h) => sum + h.dayChange, 0);
  const totalDayChangePercent = (totalDayChange / (totalValue - totalDayChange)) * 100;
  const { data: historicalData, benchmark: benchmarkHistory } = generateHistoricalData();

  return {
    portfolioId: 'demo',
    displayName: 'Demo Portfolio',
    totalValue,
    totalDayChange,
    totalDayChangePercent,
    totalGain: null, // Mock data doesn't have cost basis
    totalGainPercent: null,
    holdings,
    historicalData,
    benchmarkHistory,
    lastUpdated: new Date(),
    marketStatus: 'closed',
    benchmark: {
      ticker: 'SPY',
      name: 'S&P 500',
      dayChangePercent: 0.25,
    },
    hotTake: null,
    hotTakeAt: null,
    buffettComment: null,
    buffettCommentAt: null,
    mungerComment: null,
    mungerCommentAt: null,
  };
}
