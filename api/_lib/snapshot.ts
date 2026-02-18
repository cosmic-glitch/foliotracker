import {
  getPortfolios,
  getHoldings,
  getDailyPrices,
  upsertDailyPrice,
  upsertPriceCache,
  upsertPortfolioSnapshot,
  recordSnapshotError,
  getCachedFundamentals,
  upsertFundamentalsCache,
  type DbHolding,
  type DbPriceCache,
  type DbFundamentalsCache,
  type SnapshotHolding,
  type HistoryDataPoint,
  type BenchmarkDataPoint,
  type DbPortfolioSnapshot,
} from './db.js';
import { getMultipleQuotes, getHistoricalData, type Quote } from './yahoo.js';
import { getMarketStatus, getStartOfTradingDay } from './cache.js';
import { setSnapshotInRedis, setPricesInRedis } from './redis.js';

const BENCHMARK_TICKER = 'SPY';

interface PriceData {
  currentPrice: number;
  previousClose: number;
  changePercent: number;
}

const FUNDAMENTALS_STALE_HOURS = 12;

// Fetch fundamentals from companiesmarketcap API, using cache when fresh
async function fetchFundamentals(tickers: string[]): Promise<Map<string, DbFundamentalsCache>> {
  if (tickers.length === 0) return new Map();

  const cached = await getCachedFundamentals(tickers);
  const now = Date.now();
  const staleMs = FUNDAMENTALS_STALE_HOURS * 60 * 60 * 1000;

  // Find tickers that are stale or missing
  const staleTickers: string[] = [];
  for (const ticker of tickers) {
    const entry = cached.get(ticker);
    if (!entry || (now - new Date(entry.updated_at).getTime()) > staleMs) {
      staleTickers.push(ticker);
    }
  }

  if (staleTickers.length > 0) {
    console.log(`Fetching fundamentals for ${staleTickers.length} stale tickers...`);
    try {
      const url = `https://www.companiesmarketcap.org/api/company?symbols=${staleTickers.join(',')}&fields=revenue,earnings,forwardEPS,week52High,operatingMargin,revenueGrowth3Y,epsGrowth3Y`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const companies = json.companies || {};
        const upserts: Array<{
          ticker: string;
          revenue: number | null;
          earnings: number | null;
          forward_eps: number | null;
          week_52_high: number | null;
          operating_margin: number | null;
          revenue_growth_3y: number | null;
          eps_growth_3y: number | null;
        }> = [];

        for (const ticker of staleTickers) {
          const data = companies[ticker];
          if (data) {
            const entry = {
              ticker,
              revenue: data.revenue ?? null,
              earnings: data.earnings ?? null,
              forward_eps: data.forwardEPS ?? null,
              week_52_high: data.week52High ?? null,
              operating_margin: data.operatingMargin ?? null,
              revenue_growth_3y: data.revenueGrowth3Y ?? null,
              eps_growth_3y: data.epsGrowth3Y ?? null,
            };
            upserts.push(entry);
            cached.set(ticker, { ...entry, updated_at: new Date().toISOString() });
          }
        }

        if (upserts.length > 0) {
          await upsertFundamentalsCache(upserts);
          console.log(`Updated fundamentals_cache for ${upserts.length} tickers`);
        }
      } else {
        console.warn(`Fundamentals API returned ${res.status}, using cached data`);
      }
    } catch (error) {
      console.warn('Failed to fetch fundamentals, using cached data:', error);
    }
  }

  return cached;
}

// Compute holdings with current values from price cache
function computeHoldings(
  dbHoldings: DbHolding[],
  prices: Map<string, PriceData>,
  fundamentals: Map<string, DbFundamentalsCache> = new Map()
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
        revenue: null,
        earnings: null,
        forwardPE: null,
        pctTo52WeekHigh: null,
        operatingMargin: null,
        revenueGrowth3Y: null,
        epsGrowth3Y: null,
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

      const fund = fundamentals.get(holding.ticker);
      const forwardPE = (fund?.forward_eps && fund.forward_eps > 0 && price.currentPrice > 0)
        ? price.currentPrice / fund.forward_eps
        : null;
      const pctTo52WeekHigh = (fund?.week_52_high && fund.week_52_high > 0 && price.currentPrice > 0)
        ? ((fund.week_52_high - price.currentPrice) / price.currentPrice) * 100
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
        revenue: fund?.revenue ?? null,
        earnings: fund?.earnings ?? null,
        forwardPE,
        pctTo52WeekHigh,
        operatingMargin: fund?.operating_margin ?? null,
        revenueGrowth3Y: fund?.revenue_growth_3y ?? null,
        epsGrowth3Y: fund?.eps_growth_3y ?? null,
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
          // Try fill forward from previous price
          for (const ts of sortedTimestamps) {
            if (ts > timestamp) break;
            const p = priceMap.get(ts);
            if (p) price = p;
          }
        }
        // If still no price (e.g., money market funds with single end-of-day data point),
        // use currentPrice as fallback to ensure consistent contribution throughout the chart
        if (!price) {
          const currentPriceData = currentPrices.get(ticker);
          if (currentPriceData) {
            price = currentPriceData.currentPrice;
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

  // Fetch current quotes from Yahoo Finance
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

  // Update price cache (DB and Redis)
  await upsertPriceCache(priceCacheUpdates);
  await setPricesInRedis(priceCacheUpdates.map(p => ({
    ticker: p.ticker,
    current_price: p.current_price,
    previous_close: p.previous_close,
    change_percent: p.change_percent,
    updated_at: new Date().toISOString(),
  })));
  console.log(`Updated price_cache for ${priceCacheUpdates.length} tickers`);

  // Fetch fundamentals data (revenue, earnings, forward EPS, 52wk high)
  const nonStaticTickers = Array.from(allTickers).filter(t => t !== BENCHMARK_TICKER);
  const fundamentalsMap = await fetchFundamentals(nonStaticTickers);

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

  // Fetch 1D intraday data (always fetch to ensure chart works after hours)
  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  console.log('Fetching 1D intraday data...');
  const startOfDay = getStartOfTradingDay();

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

    const { holdings: snapshotHoldings, totalValue, totalDayChange, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap, fundamentalsMap);
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
      last_error: null,
      last_error_at: null,
    };

    await upsertPortfolioSnapshot(snapshot);
    // Also write to Redis cache
    await setSnapshotInRedis(portfolio.id, { ...snapshot, updated_at: new Date().toISOString() });
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

  // Update price cache (DB and Redis)
  await upsertPriceCache(priceCacheUpdates);
  await setPricesInRedis(priceCacheUpdates.map(p => ({
    ticker: p.ticker,
    current_price: p.current_price,
    previous_close: p.previous_close,
    change_percent: p.change_percent,
    updated_at: new Date().toISOString(),
  })));

  // Fetch fundamentals data
  const nonStaticTickers = tickers.filter(t => t !== BENCHMARK_TICKER);
  const fundamentalsMap = await fetchFundamentals(nonStaticTickers);

  // Fetch historical data
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 35);

  const existingPrices = await getDailyPrices(tickers, 35);
  const historicalPrices = new Map<string, Map<string, number>>();
  const existingDates = new Map<string, Set<string>>();

  for (const price of existingPrices) {
    if (!historicalPrices.has(price.ticker)) {
      historicalPrices.set(price.ticker, new Map());
    }
    if (!existingDates.has(price.ticker)) {
      existingDates.set(price.ticker, new Set());
    }
    historicalPrices.get(price.ticker)!.set(price.date, price.close_price);
    existingDates.get(price.ticker)!.add(price.date);
  }

  // Check which tickers need fresh historical data (more than 1 day old)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const tickersToFetch: string[] = [];
  for (const ticker of tickers) {
    const tickerDates = existingDates.get(ticker) || new Set();
    const sortedDates = Array.from(tickerDates).sort();
    const mostRecent = sortedDates[sortedDates.length - 1];

    if (tickerDates.size === 0 || (mostRecent && mostRecent < yesterdayStr)) {
      tickersToFetch.push(ticker);
    }
  }

  // Fetch missing historical data only for stale tickers
  if (tickersToFetch.length > 0) {
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
      console.log(`Cached ${cachePromises.length} daily price records for portfolio ${portfolioId}`);
    }
  }

  // Fetch 1D intraday data (always fetch to ensure chart works after hours)
  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  const startOfDay = getStartOfTradingDay();

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
  const { holdings: snapshotHoldings, totalValue, totalDayChange, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap, fundamentalsMap);
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
    last_error: null,
    last_error_at: null,
  };

  await upsertPortfolioSnapshot(snapshot);
  // Also write to Redis cache
  await setSnapshotInRedis(portfolioId, { ...snapshot, updated_at: new Date().toISOString() });
  console.log(`Snapshot refreshed for portfolio: ${portfolioId}`);
}
