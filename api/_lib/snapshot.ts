import {
  getPortfolios,
  getHoldings,
  getDailyPrices,
  upsertDailyPrice,
  upsertPriceCache,
  upsertPortfolioSnapshot,
  getCachedFundamentals,
  upsertFundamentalsCache,
  getCachedPrices,
  type DbHolding,
  type DbFundamentalsCache,
  type SnapshotHolding,
  type HistoryDataPoint,
  type BenchmarkDataPoint,
  type DbPortfolioSnapshot,
  getAllPortfolioSnapshots,
  getPortfolioSnapshot,
  upsertPortfolioDailyValues,
  type DbPortfolioDailyValue,
  type DbHoldingsHistory,
} from './db.js';
import { getMultipleQuotes, getHistoricalData } from './yahoo.js';
import { getCurrentTradingSessionRange, getMarketStatus, isLiveMarketSession, isDailyNavStale, createETDate, getDailyValueRecordDate } from './cache.js';
import { setSnapshotInRedis, setPricesInRedis } from './redis.js';
import {
  closedTodayTickers,
  dayTotals,
  editsFor,
  getTodaysHoldingsEdits,
  getTradeWindow,
  resolveDayEdits,
  type ClosedTodayLine,
  type DayEdits,
  type DayFlowFields,
  type TradeWindow,
} from './day-flows.js';

const BENCHMARK_TICKER = 'SPY';

interface PriceData {
  currentPrice: number;
  previousClose: number;
  changePercent: number;
}

const FUNDAMENTALS_STALE_HOURS = 12;

// Past this age a cache row is dropped rather than served. A ticker that
// leaves companiesmarketcap.org (its scraper only covers market caps above
// $1B — TRIP fell under in Nov 2026) never refreshes, so without a cutoff
// its last revenue/EPS/PE would show forever. A week rides out an outage of our own service and a
// ticker hovering around $1B; after that the holding shows no fundamentals.
const FUNDAMENTALS_MAX_AGE_DAYS = 7;

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
      // Dual-class tickers (GOOG/GOOGL, BRK-A/BRK-B) are answered for every
      // class by the service itself, so held tickers are requested as-is.
      const url = `https://www.companiesmarketcap.org/api/company?symbols=${staleTickers.join(',')}&fields=revenue,earnings,peRatio,forwardEPS,forwardEPSNext,forwardEPSNext2,forwardEPSDate,forwardEPSNextDate,forwardEPSNext2Date,week52High,operatingMargin,revenueGrowth3Y,epsGrowth3Y,marketCap,price`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const companies = json.companies || {};
        const upserts: Array<{
          ticker: string;
          revenue: number | null;
          earnings: number | null;
          pe_ratio: number | null;
          forward_eps: number | null;
          forward_eps_next: number | null;
          forward_eps_next2: number | null;
          forward_eps_date: string | null;
          forward_eps_next_date: string | null;
          forward_eps_next2_date: string | null;
          week_52_high: number | null;
          operating_margin: number | null;
          revenue_growth_3y: number | null;
          eps_growth_3y: number | null;
          shares_outstanding: number | null;
        }> = [];

        for (const ticker of staleTickers) {
          const data = companies[ticker];
          if (data) {
            const entry = {
              ticker,
              revenue: data.revenue ?? null,
              earnings: data.earnings ?? null,
              pe_ratio: data.peRatio ?? null,
              forward_eps: data.forwardEPS ?? null,
              forward_eps_next: data.forwardEPSNext ?? null,
              forward_eps_next2: data.forwardEPSNext2 ?? null,
              forward_eps_date: data.forwardEPSDate ?? null,
              forward_eps_next_date: data.forwardEPSNextDate ?? null,
              forward_eps_next2_date: data.forwardEPSNext2Date ?? null,
              week_52_high: data.week52High ?? null,
              operating_margin: data.operatingMargin ?? null,
              revenue_growth_3y: data.revenueGrowth3Y ?? null,
              eps_growth_3y: data.epsGrowth3Y ?? null,
              shares_outstanding: data.marketCap > 0 && data.price > 0 ? data.marketCap / data.price : null,
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

  const maxAgeMs = FUNDAMENTALS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const [ticker, entry] of cached) {
    if (now - new Date(entry.updated_at).getTime() > maxAgeMs) {
      console.warn(`Fundamentals for ${ticker} last refreshed ${entry.updated_at}; too old, not served`);
      cached.delete(ticker);
    }
  }

  return cached;
}

// Resolve the oldest available close for a ticker — the 30D anchor used to
// compute per-holding 30D change in HoldingsTable. The 30D portfolio chart
// uses the same dataset (history_30d_json[0].value), so anchors are aligned.
function resolveThirtyDayAnchor(
  ticker: string,
  historicalPrices: Map<string, Map<string, number>>,
): number | null {
  const tickerPrices = historicalPrices.get(ticker);
  if (!tickerPrices || tickerPrices.size === 0) return null;
  // Map iteration order isn't guaranteed for date strings inserted in
  // arbitrary order; sort to find the oldest.
  const sortedDates = Array.from(tickerPrices.keys()).sort();
  const oldest = sortedDates[0];
  const price = tickerPrices.get(oldest);
  return price != null && price > 0 ? price : null;
}

// Compute holdings with current values from price cache
function computeHoldings(
  dbHoldings: DbHolding[],
  prices: Map<string, PriceData>,
  fundamentals: Map<string, DbFundamentalsCache> = new Map(),
  regularPrices?: Map<string, PriceData>,
  // Split-adjusted 52w highs from Yahoo. Preferred over
  // fundamentals.week_52_high (companiesmarketcap.org), which has been observed
  // to return pre-split values that wildly inflate peak-potential totals.
  yahoo52WeekHighs: Map<string, number> = new Map(),
  // 30D close-price history per ticker; oldest entry is each ticker's 30D
  // anchor. Empty map → 30D fields fall to null on each holding.
  historicalPrices: Map<string, Map<string, number>> = new Map(),
  // Today's edits (see day-flows.ts). Empty → every holding counts as held
  // since the previous close.
  dayEdits: Map<string, DayEdits> = new Map(),
): { holdings: SnapshotHolding[]; totalValue: number; totalGain: number | null; totalGainPercent: number | null } {
  const holdings: SnapshotHolding[] = [];
  let totalValue = 0;
  let totalCostBasis = 0;
  let totalValueWithCostBasis = 0;

  for (const holding of dbHoldings) {
    if (holding.is_static) {
      const value = holding.static_value ?? 0;
      const costBasis = holding.cost_basis;
      const profitLoss = costBasis !== null ? value - costBasis : null;
      const profitLossPercent = costBasis !== null && costBasis > 0
        ? (profitLoss! / costBasis) * 100
        : null;

      // A static line never moves, so any value change today is money moved
      // (dayFlow) — including one made outside the log.
      const edits = editsFor(dayEdits, holding.ticker, true);
      const dayFields: DayFlowFields | null = edits
        ? {
            dayBaseValue: edits.base,
            dayFlow: value - edits.base,
            dayFlowWeighted: edits.trades.reduce((sum, t) => sum + t.flow * t.weight, 0),
          }
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
        // Static holdings don't move — neither 1D nor 30D have meaningful
        // change. No per-share anchor either.
        thirtyDayChange: 0,
        thirtyDayChangePercent: 0,
        thirtyDayAnchorPrice: null,
        isStatic: true,
        instrumentType: holding.instrument_type || 'Other',
        costBasis,
        profitLoss,
        profitLossPercent,
        revenue: null,
        earnings: null,
        peRatio: null,
        forwardPE: null,
        forwardPENext: null,
        forwardPENext2: null,
        forwardEPSDate: null,
        forwardEPSNextDate: null,
        forwardEPSNext2Date: null,
        pctTo52WeekHigh: null,
        week52High: null,
        operatingMargin: null,
        revenueGrowth3Y: null,
        epsGrowth3Y: null,
        marketCap: null,
        regularMarketPrice: value,
        ...dayFields,
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
      // Per-holding % is the ticker's own move; the $ figure is trade-aware.
      const dayChangePercent = price.previousClose > 0
        ? ((price.currentPrice - price.previousClose) / price.previousClose) * 100
        : 0;
      const edits = editsFor(dayEdits, holding.ticker, false);
      let dayFields: DayFlowFields | null = null;
      if (edits) {
        // Shares changed outside the log (direct DB edit) count as held since
        // the previous close, as before.
        const baseShares = edits.base + (holding.shares - edits.final);
        dayFields = {
          dayBaseValue: baseShares * price.previousClose,
          dayFlow: edits.trades.reduce((sum, t) => sum + t.flow, 0),
          dayFlowWeighted: edits.trades.reduce((sum, t) => sum + t.flow * t.weight, 0),
        };
      }
      const dayChange = value - (dayFields?.dayBaseValue ?? holding.shares * price.previousClose) - (dayFields?.dayFlow ?? 0);

      const costBasis = holding.cost_basis;
      const profitLoss = costBasis !== null ? value - costBasis : null;
      const profitLossPercent = costBasis !== null && costBasis > 0
        ? (profitLoss! / costBasis) * 100
        : null;

      const fund = fundamentals.get(holding.ticker);
      // Negative trailing P/E (loss-making company) reads as noise — null it,
      // matching the positive-EPS guard on the forward P/Es below.
      const peRatio = (fund?.pe_ratio && fund.pe_ratio > 0) ? fund.pe_ratio : null;
      const forwardPE = (fund?.forward_eps && fund.forward_eps > 0 && price.currentPrice > 0)
        ? price.currentPrice / fund.forward_eps
        : null;
      const forwardPENext = (fund?.forward_eps_next && fund.forward_eps_next > 0 && price.currentPrice > 0)
        ? price.currentPrice / fund.forward_eps_next
        : null;
      const forwardPENext2 = (fund?.forward_eps_next2 && fund.forward_eps_next2 > 0 && price.currentPrice > 0)
        ? price.currentPrice / fund.forward_eps_next2
        : null;
      const marketCap = (fund?.shares_outstanding && fund.shares_outstanding > 0 && price.currentPrice > 0)
        ? fund.shares_outstanding * price.currentPrice
        : null;
      const yahooHigh = yahoo52WeekHighs.get(holding.ticker);
      const effective52WeekHigh = (yahooHigh && yahooHigh > 0)
        ? yahooHigh
        : (fund?.week_52_high && fund.week_52_high > 0 ? fund.week_52_high : null);
      const pctTo52WeekHigh = (effective52WeekHigh && price.currentPrice > 0)
        ? ((effective52WeekHigh - price.currentPrice) / price.currentPrice) * 100
        : null;

      const regPrice = regularPrices?.get(holding.ticker);

      // 30D per-holding figures. Anchor = oldest close in this ticker's 30D
      // series. Null when the ticker has no historical data yet (brand-new
      // addition); HoldingsTable renders "—" in that case.
      const thirtyDayAnchorPrice = resolveThirtyDayAnchor(holding.ticker, historicalPrices);
      const thirtyDayChange = thirtyDayAnchorPrice != null
        ? holding.shares * (price.currentPrice - thirtyDayAnchorPrice)
        : null;
      const thirtyDayChangePercent = thirtyDayAnchorPrice != null
        ? ((price.currentPrice - thirtyDayAnchorPrice) / thirtyDayAnchorPrice) * 100
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
        thirtyDayChange,
        thirtyDayChangePercent,
        thirtyDayAnchorPrice,
        isStatic: false,
        instrumentType: holding.instrument_type || 'Other',
        costBasis,
        profitLoss,
        profitLossPercent,
        revenue: fund?.revenue ?? null,
        earnings: fund?.earnings ?? null,
        peRatio,
        forwardPE,
        forwardPENext,
        forwardPENext2,
        // Only meaningful alongside a value, so null with its PE.
        forwardEPSDate: forwardPE != null ? fund?.forward_eps_date ?? null : null,
        forwardEPSNextDate: forwardPENext != null ? fund?.forward_eps_next_date ?? null : null,
        forwardEPSNext2Date: forwardPENext2 != null ? fund?.forward_eps_next2_date ?? null : null,
        pctTo52WeekHigh,
        week52High: effective52WeekHigh,
        operatingMargin: fund?.operating_margin ?? null,
        revenueGrowth3Y: fund?.revenue_growth_3y ?? null,
        epsGrowth3Y: fund?.eps_growth_3y ?? null,
        marketCap,
        regularMarketPrice: regPrice?.currentPrice ?? price.currentPrice,
        ...dayFields,
      });

      totalValue += value;

      if (costBasis !== null) {
        totalCostBasis += costBasis;
        totalValueWithCostBasis += value;
      }
    }
  }

  // Allocation is the regular-hours allocation, computed from the regular
  // session close (or current price for static holdings). This is the stable
  // baseline that allocation-only share-link viewers see — they can't
  // recompute client-side because dollar fields are stripped — and matches
  // what a viewer sees during the regular session after `usePortfolioData`
  // recomputes. Outside the session the hook recomputes against the
  // extended-hours `totalValue` instead.
  let regularTotalValue = 0;
  for (const holding of holdings) {
    regularTotalValue += holding.isStatic
      ? holding.value
      : holding.shares * holding.regularMarketPrice;
  }
  for (const holding of holdings) {
    const regValue = holding.isStatic
      ? holding.value
      : holding.shares * holding.regularMarketPrice;
    holding.allocation = regularTotalValue > 0 ? (regValue / regularTotalValue) * 100 : 0;
  }

  // Sort by value descending
  holdings.sort((a, b) => b.value - a.value);

  // Calculate total gain
  const totalGain = totalCostBasis > 0 ? totalValueWithCostBasis - totalCostBasis : null;
  const totalGainPercent = totalCostBasis > 0
    ? ((totalValueWithCostBasis - totalCostBasis) / totalCostBasis) * 100
    : null;

  return { holdings, totalValue, totalGain, totalGainPercent };
}

// Lines sold out (or static lines deleted) today: their move from the previous
// close up to the sale, plus their share of the % denominator. Tradeable lines
// without a quote are skipped (the naive day change ignored them too).
function computeClosedToday(
  dayEdits: Map<string, DayEdits>,
  dbHoldings: DbHolding[],
  prices: Map<string, PriceData>,
): ClosedTodayLine[] {
  const held = new Set(dbHoldings.map((h) => `${h.is_static ? 's' : 't'}:${h.ticker}`));
  const out: ClosedTodayLine[] = [];
  for (const [k, e] of dayEdits) {
    if (!e.removed || held.has(k) || e.base === 0) continue;
    const dayFlow = e.trades.reduce((sum, t) => sum + t.flow, 0);
    const dayFlowWeighted = e.trades.reduce((sum, t) => sum + t.flow * t.weight, 0);
    if (e.isStatic) {
      out.push({
        ticker: e.ticker, name: e.name, isStatic: true, baseShares: 1, previousClose: e.base,
        dayBaseValue: e.base, dayFlow: -e.base, dayFlowWeighted, dayChange: 0,
      });
      continue;
    }
    const price = prices.get(e.ticker);
    if (!price) continue;
    const dayBaseValue = e.base * price.previousClose;
    out.push({
      ticker: e.ticker, name: e.name, isStatic: false, baseShares: e.base, previousClose: price.previousClose,
      dayBaseValue, dayFlow, dayFlowWeighted, dayChange: -dayBaseValue - dayFlow,
    });
  }
  return out;
}

// Resolve one portfolio's edits for the day. A portfolio that held nothing
// before today's edits (just created, or rebuilt from empty) keeps the naive
// day change: treating its whole contents as a same-day deposit would show
// only the move since the edit, which reads as broken on a brand-new page.
function portfolioDayEdits(
  rows: DbHoldingsHistory[] | undefined,
  dbHoldings: DbHolding[],
  window: TradeWindow,
  regularPrices: Map<string, PriceData>,
  intradayPrices: Map<string, Array<{ date: string; close: number }>>,
): Map<string, DayEdits> {
  if (!rows || rows.length === 0) return new Map();
  const edits = resolveDayEdits(rows, window, regularPrices, intradayPrices);
  const heldBefore = dbHoldings.some((h) => !editsFor(edits, h.ticker, h.is_static))
    || [...edits.values()].some((e) => e.base > 0);
  return heldBefore ? edits : new Map();
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
    staticValue += holding.static_value ?? 0;
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

    if (Number.isFinite(totalValue)) {
      history.push({ date, value: totalValue });
    }
  }

  return history.slice(-30);
}

// Compute 1D intraday history.
//
// Trade-aware (see day-flows.ts): each line holds its shares as of each
// timestamp — today's edits are undone before they happened, and sold-out
// lines are held until their sale — and money an edit moves in or out is
// added to every point before that edit. The line therefore runs continuously
// through a trade (a deposit is not a jump), ends at the current value, and
// starts at the flow-adjusted previous close Σ(dayBaseValue + dayFlow) that
// App.tsx uses as the 1D base. Static lines contribute their current value
// throughout (their edits are pure flows, which cancel).
async function compute1DHistory(
  dbHoldings: DbHolding[],
  intradayPrices: Map<string, Array<{ date: string; close: number }>>,
  currentPrices: Map<string, PriceData>,
  dayEdits: Map<string, DayEdits> = new Map(),
  closedToday: ClosedTodayLine[] = [],
): Promise<HistoryDataPoint[]> {
  let constantValue = 0;
  for (const holding of dbHoldings) {
    if (holding.is_static) constantValue += holding.static_value ?? 0;
  }

  // Every tradeable line on the chart: current holdings plus closed lines.
  const lines: Array<{ ticker: string; shares: number; edits?: DayEdits }> = [];
  for (const holding of dbHoldings) {
    if (holding.is_static) continue;
    lines.push({ ticker: holding.ticker, shares: holding.shares, edits: editsFor(dayEdits, holding.ticker, false) });
  }
  for (const c of closedToday) {
    if (!c.isStatic) lines.push({ ticker: c.ticker, shares: 0, edits: editsFor(dayEdits, c.ticker, false) });
  }

  const priceMaps = new Map<string, Map<string, number>>();
  const allTimestamps = new Set<string>();
  for (const { ticker } of lines) {
    const data = intradayPrices.get(ticker);
    if (!data || data.length === 0) continue;
    const priceMap = new Map<string, number>();
    for (const point of data) {
      priceMap.set(point.date, point.close);
      allTimestamps.add(point.date);
    }
    priceMaps.set(ticker, priceMap);
  }

  const sortedTimestamps = Array.from(allTimestamps).sort();
  const lastPrice = new Map<string, number>();
  const history: HistoryDataPoint[] = [];

  for (const timestamp of sortedTimestamps) {
    const at = Date.parse(timestamp);
    let totalValue = constantValue;

    for (const { ticker, shares, edits } of lines) {
      const p = priceMaps.get(ticker)?.get(timestamp);
      if (p) lastPrice.set(ticker, p);
      // No print yet (or no intraday data at all, e.g. once-daily funds):
      // carry the last print, else the current price.
      const price = lastPrice.get(ticker) ?? currentPrices.get(ticker)?.currentPrice;
      if (!price) continue;
      let sharesAt = shares;
      let pendingFlow = 0;
      for (const t of edits?.trades ?? []) {
        if (t.at > at) {
          sharesAt -= t.deltaShares;
          pendingFlow += t.flow;
        }
      }
      totalValue += sharesAt * price + pendingFlow;
    }

    if (Number.isFinite(totalValue)) {
      history.push({ date: timestamp, value: totalValue });
    }
  }

  return history;
}

function applyIntradayPriceOverrides(
  prices: Map<string, PriceData>,
  intradayPrices: Map<string, Array<{ date: string; close: number }>>
): void {
  for (const [ticker, data] of intradayPrices.entries()) {
    if (data.length === 0) continue;

    const latestClose = data[data.length - 1].close;
    const existing = prices.get(ticker);
    if (!existing) continue;

    const changePercent = existing.previousClose > 0
      ? ((latestClose - existing.previousClose) / existing.previousClose) * 100
      : 0;

    prices.set(ticker, {
      currentPrice: latestClose,
      previousClose: existing.previousClose,
      changePercent,
    });
  }
}

// Reset the day change for once-daily-priced instruments (mutual funds / money
// market) whose NAV hasn't refreshed for the current session yet. See
// isDailyNavStale: after a new regular session opens, Yahoo keeps serving the
// prior session's NAV alongside its stale day change. We collapse previousClose
// to currentPrice so the change reads 0 everywhere it's (re)computed downstream
// — snapshot holdings, portfolio totals, the price cache, and the client-side
// regular-hours recompute in usePortfolioData — rather than carrying yesterday's
// move forward as if it were today's. Self-heals once the new NAV publishes.
function applyDailyNavStaleReset(
  prices: Map<string, PriceData>,
  instrumentTypes: Map<string, string>,
  quoteTimes: Map<string, number | null>,
  now: Date
): void {
  for (const [ticker, price] of prices.entries()) {
    const type = instrumentTypes.get(ticker);
    if (type !== 'Mutual Fund' && type !== 'Money Market') continue;
    if (!isDailyNavStale(quoteTimes.get(ticker) ?? null, now)) continue;

    prices.set(ticker, {
      currentPrice: price.currentPrice,
      previousClose: price.currentPrice,
      changePercent: 0,
    });
  }
}

function buildPriceCacheUpdates(prices: Map<string, PriceData>): Array<{
  ticker: string;
  current_price: number;
  previous_close: number;
  change_percent: number;
}> {
  return Array.from(prices.entries()).map(([ticker, price]) => ({
    ticker,
    current_price: price.currentPrice,
    previous_close: price.previousClose,
    change_percent: price.changePercent,
  }));
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
  // ticker → instrument type, used to detect once-daily-priced funds whose NAV
  // change goes stale after a new session opens (see applyDailyNavStaleReset).
  const instrumentTypes = new Map<string, string>();

  for (const portfolio of portfolios) {
    const holdings = await getHoldings(portfolio.id);
    allHoldingsMap.set(portfolio.id, holdings);
    for (const holding of holdings) {
      if (!holding.is_static) {
        allTickers.add(holding.ticker);
        if (holding.instrument_type) instrumentTypes.set(holding.ticker, holding.instrument_type);
      }
    }
  }

  // Today's holdings edits (trade-aware day change, day-flows.ts). Tickers
  // sold out today are quoted too so their move up to the sale is priced.
  const tradeWindow = getTradeWindow();
  const todaysEdits = await getTodaysHoldingsEdits(tradeWindow);
  for (const portfolio of portfolios) {
    const rows = todaysEdits.get(portfolio.id);
    if (!rows) continue;
    for (const t of closedTodayTickers(rows, allHoldingsMap.get(portfolio.id) || [])) allTickers.add(t);
  }

  // Add benchmark ticker
  allTickers.add(BENCHMARK_TICKER);

  const tickerArray = Array.from(allTickers);
  console.log(`Fetching quotes for ${tickerArray.length} tickers...`);

  // Fetch current quotes from Yahoo Finance
  const quotes = await getMultipleQuotes(tickerArray);

  // Build price map from quote data (intraday overrides applied later)
  const priceMap = new Map<string, PriceData>();
  const yahoo52WeekHighMap = new Map<string, number>();
  // ticker → last NAV/print time (epoch ms) for the stale-fund reset below.
  const quoteTimes = new Map<string, number | null>();

  for (const [ticker, quote] of quotes.entries()) {
    priceMap.set(ticker, {
      currentPrice: quote.currentPrice,
      previousClose: quote.previousClose,
      changePercent: quote.changePercent,
    });
    quoteTimes.set(ticker, quote.regularMarketTime);
    if (quote.fiftyTwoWeekHigh != null) {
      yahoo52WeekHighMap.set(ticker, quote.fiftyTwoWeekHigh);
    }
  }

  // Fall back to cached prices for any tickers that Yahoo failed to return
  const staleTickers = new Set<string>();
  const missingTickers = tickerArray.filter(t => !priceMap.has(t));
  if (missingTickers.length > 0) {
    console.warn(`Yahoo failed for ${missingTickers.length} tickers, falling back to price_cache: ${missingTickers.join(', ')}`);
    const cachedPrices = await getCachedPrices(missingTickers);
    for (const [ticker, cached] of cachedPrices.entries()) {
      priceMap.set(ticker, {
        currentPrice: cached.current_price,
        previousClose: cached.previous_close,
        changePercent: cached.change_percent,
      });
      staleTickers.add(ticker);
    }
    const stillMissing = missingTickers.filter(t => !priceMap.has(t));
    if (stillMissing.length > 0) {
      console.error(`No price data at all (Yahoo + cache) for: ${stillMissing.join(', ')}`);
    }
  }

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

  // Fetch 1D intraday data for the current/most recent trading session
  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  console.log('Fetching 1D intraday data...');
  const sessionRange = getCurrentTradingSessionRange(today);
  const intradayEnd = isLiveMarketSession(today) ? today : sessionRange.end;

  const intradayPromises = tickerArray.map(async (ticker) => {
    const data = await getHistoricalData(ticker, sessionRange.start, intradayEnd, '1m', true);
    return { ticker, data };
  });

  const intradayResults = await Promise.all(intradayPromises);
  for (const { ticker, data } of intradayResults) {
    intradayPrices.set(ticker, data);
  }

  // Save regular market prices BEFORE intraday overrides
  const regularPriceMap = new Map<string, PriceData>();
  for (const [ticker, price] of priceMap.entries()) {
    regularPriceMap.set(ticker, { ...price });
  }

  // Use latest intraday close as current price where available.
  applyIntradayPriceOverrides(priceMap, intradayPrices);

  // Zero out stale prior-session day change for funds that haven't repriced yet.
  applyDailyNavStaleReset(priceMap, instrumentTypes, quoteTimes, today);

  // Update price cache (DB and Redis) with latest effective prices.
  const priceCacheUpdates = buildPriceCacheUpdates(priceMap);
  await upsertPriceCache(priceCacheUpdates);
  await setPricesInRedis(priceCacheUpdates.map(p => ({
    ticker: p.ticker,
    current_price: p.current_price,
    previous_close: p.previous_close,
    change_percent: p.change_percent,
    updated_at: new Date().toISOString(),
  })));
  console.log(`Updated price_cache for ${priceCacheUpdates.length} tickers`);

  // Compute SPY benchmark
  const spyHistoricalPrices = historicalPrices.get(BENCHMARK_TICKER) || new Map();
  const benchmarkHistory = computeBenchmarkHistory(spyHistoricalPrices);

  // Get market status
  const marketStatus = getMarketStatus();

  // Batch-read existing snapshots for regular_history_1d_json fallback
  const existingSnapshots = await getAllPortfolioSnapshots();
  const existingSnapshotMap = new Map(existingSnapshots.map(s => [s.portfolio_id, s]));

  // Compute regular session boundaries for filtering 1D data
  const tradingDate = sessionRange.tradingDate;
  const regularStart = createETDate(tradingDate, 9, 30).getTime();
  const regularEnd = createETDate(tradingDate, 16, 0).getTime();

  // Compute snapshots for each portfolio
  console.log(`Computing snapshots for ${portfolios.length} portfolios...`);
  for (const portfolio of portfolios) {
    const holdings = allHoldingsMap.get(portfolio.id) || [];

    const dayEdits = portfolioDayEdits(todaysEdits.get(portfolio.id), holdings, tradeWindow, regularPriceMap, intradayPrices);
    const { holdings: snapshotHoldings, totalValue, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap, fundamentalsMap, regularPriceMap, yahoo52WeekHighMap, historicalPrices, dayEdits);
    const closedToday = computeClosedToday(dayEdits, holdings, priceMap);
    const { dayChange: totalDayChange, dayChangePercent: totalDayChangePercent } = dayTotals(snapshotHoldings, closedToday, (h) => h.value);

    const history30d = await compute30DHistory(holdings, historicalPrices);
    const history1d = await compute1DHistory(holdings, intradayPrices, priceMap, dayEdits, closedToday);

    // Compute regular-hours-only 1D history
    let regularHistory1d = history1d.filter(point => {
      const ts = new Date(point.date).getTime();
      return ts >= regularStart && ts <= regularEnd;
    });

    // Fallback: if no regular session data yet (e.g. pre-market), carry forward previous
    if (regularHistory1d.length === 0) {
      const existing = existingSnapshotMap.get(portfolio.id);
      regularHistory1d = existing?.regular_history_1d_json ?? [];
    }

    // Determine which of this portfolio's tickers used stale cached prices
    const portfolioStaleTickers = holdings
      .filter(h => !h.is_static && staleTickers.has(h.ticker))
      .map(h => h.ticker);

    const snapshot: Omit<DbPortfolioSnapshot, 'updated_at'> = {
      portfolio_id: portfolio.id,
      total_value: totalValue,
      day_change: totalDayChange,
      day_change_percent: totalDayChangePercent,
      total_gain: totalGain,
      total_gain_percent: totalGainPercent,
      holdings_json: snapshotHoldings,
      day_closed_json: closedToday,
      history_30d_json: history30d,
      history_1d_json: history1d,
      regular_history_1d_json: regularHistory1d,
      benchmark_30d_json: benchmarkHistory,
      market_status: marketStatus,
      last_error: null,
      last_error_at: null,
      stale_tickers: portfolioStaleTickers,
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
  // Today's edits (day-flows.ts); sold-out tickers are quoted too.
  const tradeWindow = getTradeWindow();
  const todaysRows = (await getTodaysHoldingsEdits(tradeWindow, portfolioId)).get(portfolioId.toLowerCase());
  if (todaysRows) tickers.push(...closedTodayTickers(todaysRows, holdings));
  tickers.push(BENCHMARK_TICKER);

  // Fetch current quotes
  const quotes = await getMultipleQuotes(tickers);

  // Build price map from quote data (intraday overrides applied later)
  const priceMap = new Map<string, PriceData>();
  const yahoo52WeekHighMap = new Map<string, number>();
  // ticker → last NAV/print time (epoch ms) for the stale-fund reset below.
  const quoteTimes = new Map<string, number | null>();

  for (const [ticker, quote] of quotes.entries()) {
    priceMap.set(ticker, {
      currentPrice: quote.currentPrice,
      previousClose: quote.previousClose,
      changePercent: quote.changePercent,
    });
    quoteTimes.set(ticker, quote.regularMarketTime);
    if (quote.fiftyTwoWeekHigh != null) {
      yahoo52WeekHighMap.set(ticker, quote.fiftyTwoWeekHigh);
    }
  }

  // ticker → instrument type, used to detect once-daily-priced funds whose NAV
  // change goes stale after a new session opens (see applyDailyNavStaleReset).
  const instrumentTypes = new Map<string, string>();
  for (const holding of holdings) {
    if (!holding.is_static && holding.instrument_type) {
      instrumentTypes.set(holding.ticker, holding.instrument_type);
    }
  }

  // Fall back to cached prices for any tickers that Yahoo failed to return
  const staleTickers = new Set<string>();
  const missingTickers = tickers.filter(t => !priceMap.has(t));
  if (missingTickers.length > 0) {
    console.warn(`Yahoo failed for ${missingTickers.length} tickers, falling back to price_cache: ${missingTickers.join(', ')}`);
    const cachedPrices = await getCachedPrices(missingTickers);
    for (const [ticker, cached] of cachedPrices.entries()) {
      priceMap.set(ticker, {
        currentPrice: cached.current_price,
        previousClose: cached.previous_close,
        changePercent: cached.change_percent,
      });
      staleTickers.add(ticker);
    }
    const stillMissing = missingTickers.filter(t => !priceMap.has(t));
    if (stillMissing.length > 0) {
      console.error(`No price data at all (Yahoo + cache) for: ${stillMissing.join(', ')}`);
    }
  }

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

  // Fetch 1D intraday data for the current/most recent trading session.
  const intradayPrices = new Map<string, Array<{ date: string; close: number }>>();
  const sessionRange = getCurrentTradingSessionRange(today);
  const intradayEnd = isLiveMarketSession(today) ? today : sessionRange.end;

  const intradayPromises = tickers.map(async (ticker) => {
    const data = await getHistoricalData(ticker, sessionRange.start, intradayEnd, '1m', true);
    return { ticker, data };
  });

  const intradayResults = await Promise.all(intradayPromises);
  for (const { ticker, data } of intradayResults) {
    intradayPrices.set(ticker, data);
  }

  // Save regular market prices BEFORE intraday overrides
  const regularPriceMap = new Map<string, PriceData>();
  for (const [ticker, price] of priceMap.entries()) {
    regularPriceMap.set(ticker, { ...price });
  }

  // Use latest intraday close as current price where available.
  applyIntradayPriceOverrides(priceMap, intradayPrices);

  // Zero out stale prior-session day change for funds that haven't repriced yet.
  applyDailyNavStaleReset(priceMap, instrumentTypes, quoteTimes, today);

  // Update price cache (DB and Redis) with latest effective prices.
  const priceCacheUpdates = buildPriceCacheUpdates(priceMap);
  await upsertPriceCache(priceCacheUpdates);
  await setPricesInRedis(priceCacheUpdates.map(p => ({
    ticker: p.ticker,
    current_price: p.current_price,
    previous_close: p.previous_close,
    change_percent: p.change_percent,
    updated_at: new Date().toISOString(),
  })));

  // Compute benchmark
  const spyPrices = historicalPrices.get(BENCHMARK_TICKER) || new Map();
  const benchmarkHistory = computeBenchmarkHistory(spyPrices);

  // Compute snapshot
  const dayEdits = portfolioDayEdits(todaysRows, holdings, tradeWindow, regularPriceMap, intradayPrices);
  const { holdings: snapshotHoldings, totalValue, totalGain, totalGainPercent } = computeHoldings(holdings, priceMap, fundamentalsMap, regularPriceMap, yahoo52WeekHighMap, historicalPrices, dayEdits);
  const closedToday = computeClosedToday(dayEdits, holdings, priceMap);
  const { dayChange: totalDayChange, dayChangePercent: totalDayChangePercent } = dayTotals(snapshotHoldings, closedToday, (h) => h.value);

  const history30d = await compute30DHistory(holdings, historicalPrices);
  const history1d = await compute1DHistory(holdings, intradayPrices, priceMap, dayEdits, closedToday);

  // Compute regular-hours-only 1D history
  const singleTradingDate = sessionRange.tradingDate;
  const singleRegularStart = createETDate(singleTradingDate, 9, 30).getTime();
  const singleRegularEnd = createETDate(singleTradingDate, 16, 0).getTime();

  let regularHistory1d = history1d.filter(point => {
    const ts = new Date(point.date).getTime();
    return ts >= singleRegularStart && ts <= singleRegularEnd;
  });

  // Fallback: if no regular session data yet, carry forward from existing snapshot
  if (regularHistory1d.length === 0) {
    const existing = await getPortfolioSnapshot(portfolioId);
    regularHistory1d = existing?.regular_history_1d_json ?? [];
  }

  // Determine which of this portfolio's tickers used stale cached prices
  const portfolioStaleTickers = holdings
    .filter(h => !h.is_static && staleTickers.has(h.ticker))
    .map(h => h.ticker);

  const snapshot: Omit<DbPortfolioSnapshot, 'updated_at'> = {
    portfolio_id: portfolioId.toLowerCase(),
    total_value: totalValue,
    day_change: totalDayChange,
    day_change_percent: totalDayChangePercent,
    total_gain: totalGain,
    total_gain_percent: totalGainPercent,
    holdings_json: snapshotHoldings,
    day_closed_json: closedToday,
    history_30d_json: history30d,
    history_1d_json: history1d,
    regular_history_1d_json: regularHistory1d,
    benchmark_30d_json: benchmarkHistory,
    market_status: getMarketStatus(),
    last_error: null,
    last_error_at: null,
    stale_tickers: portfolioStaleTickers,
  };

  await upsertPortfolioSnapshot(snapshot);
  // Also write to Redis cache
  await setSnapshotInRedis(portfolioId, { ...snapshot, updated_at: new Date().toISOString() });
  console.log(`Snapshot refreshed for portfolio: ${portfolioId}`);
}

// Portfolio History: after each close, upsert every portfolio's closing value +
// per-holding breakdown for the day, from the snapshots the refresh just wrote.
// Runs every tick of the recording window (close+15m → ET midnight), so the
// last write of the evening wins — late fund NAVs and post-close edits land.
// Values use the regular-session close (`regularMarketPrice`), never an
// extended-hours print. Snapshots older than SNAPSHOT_MAX_AGE_MS (refresh
// failing for that portfolio) are skipped rather than recorded stale.
const SNAPSHOT_MAX_AGE_MS = 90 * 60 * 1000;

export async function recordDailyValues(now: Date = new Date()): Promise<number> {
  const date = getDailyValueRecordDate(now);
  if (!date) return 0;

  const snapshots = await getAllPortfolioSnapshots();
  const rows: DbPortfolioDailyValue[] = [];
  for (const snapshot of snapshots) {
    if (now.getTime() - new Date(snapshot.updated_at).getTime() > SNAPSHOT_MAX_AGE_MS) {
      console.warn(`[daily-values] skipping ${snapshot.portfolio_id}: snapshot is stale (${snapshot.updated_at})`);
      continue;
    }
    const holdings = (snapshot.holdings_json ?? []).map((h) => ({
      ticker: h.ticker,
      name: h.name,
      shares: h.shares,
      value: h.isStatic ? h.value : h.shares * (h.regularMarketPrice ?? h.currentPrice),
      isStatic: h.isStatic,
      instrumentType: h.instrumentType,
    }));
    if (holdings.length === 0) continue;
    rows.push({
      portfolio_id: snapshot.portfolio_id,
      date,
      total_value: holdings.reduce((sum, h) => sum + h.value, 0),
      holdings,
      source: 'recorded',
    });
  }

  await upsertPortfolioDailyValues(rows);
  return rows.length;
}
