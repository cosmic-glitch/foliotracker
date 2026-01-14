import {
  getPortfolios,
  getHoldings,
  getDailyPrices,
  upsertDailyPrice,
  upsertPriceCache,
  upsertPortfolioSnapshot,
  type DbHolding,
  type DbPriceCache,
  type SnapshotHolding,
  type HistoryDataPoint,
  type BenchmarkDataPoint,
  type DbPortfolioSnapshot,
} from './db.js';
import { getMultipleQuotes, getHistoricalData, type Quote } from './fmp.js';
import { getMarketStatus } from './cache.js';

const BENCHMARK_TICKER = 'SPY';

interface PriceData {
  currentPrice: number;
  previousClose: number;
  changePercent: number;
}

// Compute holdings with current values from price cache
function computeHoldings(
  dbHoldings: DbHolding[],
  prices: Map<string, PriceData>
): { holdings: SnapshotHolding[]; totalValue: number; totalDayChange: number; totalGain: number | null; totalGainPercent: number | null } {
  const holdings: SnapshotHolding[] = [];
  let totalValue = 0;
  let totalDayChange = 0;
  let totalCostBasis = 0;
  let totalValueWithCostBasis = 0;

  for (const holding of dbHoldings) {
    if (holding.is_static) {
      const value = holding.static_value || 0;
      const costBasis = holding.cost_basis;
      const profitLoss = costBasis !== null ? value - costBasis : null;
      const profitLossPercent = costBasis !== null && costBasis > 0
        ? (profitLoss! / costBasis) * 100
        : null;

      holdings.push({
        ticker: holding.ticker,
        name: holding.name,
        shares: holding.shares,
        currentPrice: value,
        previousClose: value,
        value,
        allocation: 0,
        dayChange: 0,
        dayChangePercent: 0,
        isStatic: true,
        instrumentType: holding.instrument_type || 'Other',
        costBasis,
        profitLoss,
        profitLossPercent,
      });
      totalValue += value;

      if (costBasis !== null) {
        totalCostBasis += costBasis;
        totalValueWithCostBasis += value;
      }
    } else {
      const price = prices.get(holding.ticker);
      if (!price) {
        console.warn(`No price data for ${holding.ticker}`);
        continue;
      }

      const value = holding.shares * price.currentPrice;
      const previousValue = holding.shares * price.previousClose;
      const dayChange = value - previousValue;
      const dayChangePercent = previousValue > 0 ? (dayChange / previousValue) * 100 : 0;

      const costBasis = holding.cost_basis;
      const profitLoss = costBasis !== null ? value - costBasis : null;
      const profitLossPercent = costBasis !== null && costBasis > 0
        ? (profitLoss! / costBasis) * 100
        : null;

      holdings.push({
        ticker: holding.ticker,
        name: holding.name,
        shares: holding.shares,
        currentPrice: price.currentPrice,
        previousClose: price.previousClose,
        value,
        allocation: 0,
        dayChange,
        dayChangePercent,
        isStatic: false,
        instrumentType: holding.instrument_type || 'Other',
        costBasis,
        profitLoss,
        profitLossPercent,
      });

      totalValue += value;
      totalDayChange += dayChange;

      if (costBasis !== null) {
        totalCostBasis += costBasis;
        totalValueWithCostBasis += value;
      }
    }
  }

  // Set allocations
  for (const holding of holdings) {
    holding.allocation = totalValue > 0 ? (holding.value / totalValue) * 100 : 0;
  }

  // Sort by value descending
  holdings.sort((a, b) => b.value - a.value);

  // Calculate total gain
  const totalGain = totalCostBasis > 0 ? totalValueWithCostBasis - totalCostBasis : null;
  const totalGainPercent = totalCostBasis > 0
    ? ((totalValueWithCostBasis - totalCostBasis) / totalCostBasis) * 100
    : null;

  return { holdings, totalValue, totalDayChange, totalGain, totalGainPercent };
}

// Compute 30D historical portfolio values
async function compute30DHistory(
  dbHoldings: DbHolding[],
  historicalPrices: Map<string, Map<string, number>>
): Promise<HistoryDataPoint[]> {
  const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
  const staticHoldings = dbHoldings.filter((h) => h.is_static);

  // Calculate static value
  let staticValue = 0;
  for (const holding of staticHoldings) {
    staticValue += holding.static_value || 0;
  }

  // Get all unique dates
  const allDates = new Set<string>();
  for (const tickerPrices of historicalPrices.values()) {
    for (const date of tickerPrices.keys()) {
      allDates.add(date);
    }
  }

  const sortedDates = Array.from(allDates).sort();
  const history: HistoryDataPoint[] = [];

  for (const date of sortedDates) {
    let totalValue = staticValue;

    for (const holding of tradeableHoldings) {
      const tickerPrices = historicalPrices.get(holding.ticker);
      if (tickerPrices) {
        let price = tickerPrices.get(date);
        if (!price) {
          // Find most recent previous price
          for (const d of sortedDates) {
            if (d > date) break;
            const p = tickerPrices.get(d);
            if (p) price = p;
          }
        }
        if (price) {
          totalValue += holding.shares * price;
        }
      }
    }

    if (totalValue > 0) {
      history.push({ date, value: totalValue });
    }
  }

  return history.slice(-30);
}

// Compute 1D intraday history
async function compute1DHistory(
  dbHoldings: DbHolding[],
  intradayPrices: Map<string, Array<{ date: string; close: number }>>,
  currentPrices: Map<string, PriceData>
): Promise<HistoryDataPoint[]> {
  const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
  const staticHoldings = dbHoldings.filter((h) => h.is_static);

  // Calculate constant value (static + holdings without intraday data)
  let constantValue = 0;
  for (const holding of staticHoldings) {
    constantValue += holding.static_value || 0;
  }

  const holdingsWithData: Array<{ ticker: string; shares: number; data: Array<{ date: string; close: number }> }> = [];

  for (const holding of tradeableHoldings) {
    const data = intradayPrices.get(holding.ticker);
    if (!data || data.length === 0) {
      // No intraday data - use current price
      const price = currentPrices.get(holding.ticker);
      if (price) {
        constantValue += holding.shares * price.currentPrice;
      }
    } else {
      holdingsWithData.push({ ticker: holding.ticker, shares: holding.shares, data });
    }
  }

  // Collect all unique timestamps
  const allTimestamps = new Set<string>();
  for (const { data } of holdingsWithData) {
    for (const point of data) {
      allTimestamps.add(point.date);
    }
  }

  const sortedTimestamps = Array.from(allTimestamps).sort();

  // Build price maps
  const priceMaps = new Map<string, Map<string, number>>();
  for (const { ticker, data } of holdingsWithData) {
    const priceMap = new Map<string, number>();
    for (const point of data) {
      priceMap.set(point.date, point.close);
    }
    priceMaps.set(ticker, priceMap);
  }

  // Calculate portfolio value at each timestamp
  const history: HistoryDataPoint[] = [];

  for (const timestamp of sortedTimestamps) {
    let totalValue = constantValue;

    for (const { ticker, shares } of holdingsWithData) {
      const priceMap = priceMaps.get(ticker);
      if (priceMap) {
        let price = priceMap.get(timestamp);
        if (!price) {
          for (const ts of sortedTimestamps) {
            if (ts > timestamp) break;
            const p = priceMap.get(ts);
            if (p) price = p;
          }
        }
        if (price) {
          totalValue += shares * price;
        }
      }
    }

    if (totalValue > 0) {
      history.push({ date: timestamp, value: totalValue });
    }
  }

  return history;
}

// Compute SPY benchmark history
function computeBenchmarkHistory(
  spyPrices: Map<string, number>
): BenchmarkDataPoint[] {
  const sortedData = Array.from(spyPrices.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30);

  if (sortedData.length === 0) return [];

  const startPrice = sortedData[0][1];
  return sortedData.map(([date, close]) => ({
    date,
    percentChange: ((close - startPrice) / startPrice) * 100,
  }));
}

// Refresh all portfolio snapshots
export async function refreshAllSnapshots(): Promise<void> {
  console.log('Starting refresh of all portfolio snapshots...');

  // Get all portfolios and their holdings
  const portfolios = await getPortfolios();
  const allHoldingsMap = new Map<string, DbHolding[]>();
  const allTickers = new Set<string>();

  for (const portfolio of portfolios) {
    const holdings = await getHoldings(portfolio.id);
    allHoldingsMap.set(portfolio.id, holdings);
    for (const holding of holdings) {
      if (!holding.is_static) {
        allTickers.add(holding.ticker);
      }
    }
  }

  // Add benchmark ticker
  allTickers.add(BENCHMARK_TICKER);

  const tickerArray = Array.from(allTickers);
  console.log(`Fetching quotes for ${tickerArray.length} tickers...`);

  // Fetch current quotes from Yahoo/FMP
  const quotes = await getMultipleQuotes(tickerArray);

  // Build price map and update price_cache
  const priceMap = new Map<string, PriceData>();
  const priceCacheUpdates: Array<{
    ticker: string;
    current_price: number;
    previous_close: number;
    change_percent: number;
  }> = [];

  for (const [ticker, quote] of quotes.entries()) {
    priceMap.set(ticker, {
      currentPrice: quote.currentPrice,
      previousClose: quote.previousClose,
      changePercent: quote.changePercent,
    });
    priceCacheUpdates.push({
      ticker,
      current_price: quote.currentPrice,
      previous_close: quote.previousClose,
      change_percent: quote.changePercent,
    });
  }

  // Update price cache
  await upsertPriceCache(priceCacheUpdates);
  console.log(`Updated price_cache for ${priceCacheUpdates.length} tickers`);

  // Fetch 30D historical data for all tickers
  console.log('Fetching 30D historical data...');
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 35); // Fetch extra days to ensure we have 30

  // Get existing daily prices from database
  const existingPrices = await getDailyPrices(tickerArray, 35);
  const existingDates = new Map<string, Set<string>>();
  for (const price of existingPrices) {
    if (!existingDates.has(price.ticker)) {
      existingDates.set(price.ticker, new Set());
    }
    existingDates.get(price.ticker)!.add(price.date);
  }

  // Build historical price map, fetching missing data
  const historicalPrices = new Map<string, Map<string, number>>();

  // Initialize with existing data
  for (const price of existingPrices) {
    if (!historicalPrices.has(price.ticker)) {
      historicalPrices.set(price.ticker, new Map());
    }
    historicalPrices.get(price.ticker)!.set(price.date, price.close_price);
  }

  // Check which tickers need fresh historical data (more than 1 day old)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const tickersToFetch: string[] = [];
  for (const ticker of tickerArray) {
    const tickerDates = existingDates.get(ticker) || new Set();
    const sortedDates = Array.from(tickerDates).sort();
    const mostRecent = sortedDates[sortedDates.length - 1];

    if (tickerDates.size === 0 || (mostRecent && mostRecent < yesterdayStr)) {
      tickersToFetch.push(ticker);
    }
  }

  // Fetch missing historical data
  if (tickersToFetch.length > 0) {
    console.log(`Fetching historical data for ${tickersToFetch.length} tickers...`);
    const fetchPromises = tickersToFetch.map(async (ticker) => {
      const data = await getHistoricalData(ticker, startDate, today);
      return { ticker, data };
    });

    const results = await Promise.all(fetchPromises);
    const cachePromises: Promise<void>[] = [];

    for (const { ticker, data } of results) {
      if (!historicalPrices.has(ticker)) {
        historicalPrices.set(ticker, new Map());
      }
      const tickerDates = existingDates.get(ticker) || new Set();

      for (const point of data) {
        historicalPrices.get(ticker)!.set(point.date, point.close);
        if (!tickerDates.has(point.date)) {
          cachePromises.push(upsertDailyPrice(ticker, point.date, point.close));
        }
      }
    }

    // Update daily_prices cache
    if (cachePromises.length > 0) {
      await Promise.all(cachePromises);
      console.log(`Cached ${cachePromises.length} daily price records`);
    }
  }

  // Fetch 1D intraday data for all tickers
  console.log('Fetching 1D intraday data...');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  const intradayPromises = tickerArray.map(async (ticker) => {
    const data = await getHistoricalData(ticker, startOfDay, today, '1m');
    return { ticker, data };
  });

  const intradayResults = await Promise.all(intradayPromises);
  for (const { ticker, data } of intradayResults) {
    intradayPrices.set(ticker, data);
  }

  // Compute SPY benchmark
  const spyHistoricalPrices = historicalPrices.get(BENCHMARK_TICKER) || new Map();
  const benchmarkHistory = computeBenchmarkHistory(spyHistoricalPrices);

  // Get market status
  const marketStatus = getMarketStatus();

  // Compute snapshots for each portfolio
  console.log(`Computing snapshots for ${portfolios.length} portfolios...`);
  for (const portfolio of portfolios) {
    const holdings = allHoldingsMap.get(portfolio.id) || [];

    const { holdings: snapshotHoldings, totalValue, totalDayChange, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap);
    const previousTotalValue = totalValue - totalDayChange;
    const totalDayChangePercent = previousTotalValue > 0 ? (totalDayChange / previousTotalValue) * 100 : 0;

    const history30d = await compute30DHistory(holdings, historicalPrices);
    const history1d = await compute1DHistory(holdings, intradayPrices, priceMap);

    const snapshot: Omit<DbPortfolioSnapshot, 'updated_at'> = {
      portfolio_id: portfolio.id,
      total_value: totalValue,
      day_change: totalDayChange,
      day_change_percent: totalDayChangePercent,
      total_gain: totalGain,
      total_gain_percent: totalGainPercent,
      holdings_json: snapshotHoldings,
      history_30d_json: history30d,
      history_1d_json: history1d,
      benchmark_30d_json: benchmarkHistory,
      market_status: marketStatus,
    };

    await upsertPortfolioSnapshot(snapshot);
    console.log(`Updated snapshot for portfolio: ${portfolio.id}`);
  }

  console.log('Refresh complete!');
}

// Refresh a single portfolio snapshot (called after edit)
export async function refreshPortfolioSnapshot(portfolioId: string): Promise<void> {
  console.log(`Refreshing snapshot for portfolio: ${portfolioId}`);

  const holdings = await getHoldings(portfolioId);
  const tickers = holdings.filter((h) => !h.is_static).map((h) => h.ticker);
  tickers.push(BENCHMARK_TICKER);

  // Fetch current quotes
  const quotes = await getMultipleQuotes(tickers);

  // Build price map
  const priceMap = new Map<string, PriceData>();
  const priceCacheUpdates: Array<{
    ticker: string;
    current_price: number;
    previous_close: number;
    change_percent: number;
  }> = [];

  for (const [ticker, quote] of quotes.entries()) {
    priceMap.set(ticker, {
      currentPrice: quote.currentPrice,
      previousClose: quote.previousClose,
      changePercent: quote.changePercent,
    });
    priceCacheUpdates.push({
      ticker,
      current_price: quote.currentPrice,
      previous_close: quote.previousClose,
      change_percent: quote.changePercent,
    });
  }

  // Update price cache
  await upsertPriceCache(priceCacheUpdates);

  // Fetch historical data
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 35);

  const existingPrices = await getDailyPrices(tickers, 35);
  const historicalPrices = new Map<string, Map<string, number>>();

  for (const price of existingPrices) {
    if (!historicalPrices.has(price.ticker)) {
      historicalPrices.set(price.ticker, new Map());
    }
    historicalPrices.get(price.ticker)!.set(price.date, price.close_price);
  }

  // Fetch fresh historical data for all tickers
  const fetchPromises = tickers.map(async (ticker) => {
    const data = await getHistoricalData(ticker, startDate, today);
    return { ticker, data };
  });

  const results = await Promise.all(fetchPromises);
  for (const { ticker, data } of results) {
    if (!historicalPrices.has(ticker)) {
      historicalPrices.set(ticker, new Map());
    }
    for (const point of data) {
      historicalPrices.get(ticker)!.set(point.date, point.close);
    }
  }

  // Fetch intraday data
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  const intradayPromises = tickers.map(async (ticker) => {
    const data = await getHistoricalData(ticker, startOfDay, today, '1m');
    return { ticker, data };
  });

  const intradayResults = await Promise.all(intradayPromises);
  for (const { ticker, data } of intradayResults) {
    intradayPrices.set(ticker, data);
  }

  // Compute benchmark
  const spyPrices = historicalPrices.get(BENCHMARK_TICKER) || new Map();
  const benchmarkHistory = computeBenchmarkHistory(spyPrices);

  // Compute snapshot
  const { holdings: snapshotHoldings, totalValue, totalDayChange, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap);
  const previousTotalValue = totalValue - totalDayChange;
  const totalDayChangePercent = previousTotalValue > 0 ? (totalDayChange / previousTotalValue) * 100 : 0;

  const history30d = await compute30DHistory(holdings, historicalPrices);
  const history1d = await compute1DHistory(holdings, intradayPrices, priceMap);

  const snapshot: Omit<DbPortfolioSnapshot, 'updated_at'> = {
    portfolio_id: portfolioId.toLowerCase(),
    total_value: totalValue,
    day_change: totalDayChange,
    day_change_percent: totalDayChangePercent,
    total_gain: totalGain,
    total_gain_percent: totalGainPercent,
    holdings_json: snapshotHoldings,
    history_30d_json: history30d,
    history_1d_json: history1d,
    benchmark_30d_json: benchmarkHistory,
    market_status: getMarketStatus(),
  };

  await upsertPortfolioSnapshot(snapshot);
  console.log(`Snapshot refreshed for portfolio: ${portfolioId}`);
}
