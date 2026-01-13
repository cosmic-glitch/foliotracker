import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getHoldings, getPortfolio, verifyPortfolioPassword, isAllowedViewer, getPortfolioViewers, Visibility } from './lib/db.js';
import { getMultipleQuotes, getQuote } from './lib/fmp.js';
import { getMarketStatus } from './lib/cache.js';

const BENCHMARK_TICKER = 'SPY';
const BENCHMARK_NAME = 'S&P 500';

interface Holding {
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

interface BenchmarkData {
  ticker: string;
  name: string;
  dayChangePercent: number;
}

interface PortfolioResponse {
  portfolioId: string;
  displayName: string | null;
  totalValue: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  totalGain: number | null;
  totalGainPercent: number | null;
  holdings: Holding[];
  lastUpdated: string;
  marketStatus: string;
  benchmark: BenchmarkData | null;
  isPrivate: boolean;
  visibility: Visibility;
  viewers?: string[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get portfolio ID from query
    const portfolioId = req.query.id as string;
    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Check if portfolio exists
    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Handle visibility-based authentication
    const password = req.query.password as string;
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();

    if (portfolio.visibility === 'private') {
      // Private portfolios require password
      if (!password) {
        res.status(200).json({
          portfolioId,
          displayName: portfolio.display_name,
          isPrivate: true,
          visibility: portfolio.visibility,
          requiresAuth: true,
        });
        return;
      }

      const isValid = await verifyPortfolioPassword(portfolioId, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    } else if (portfolio.visibility === 'selective') {
      // Selective portfolios require either password or being an allowed viewer
      const hasPassword = password && await verifyPortfolioPassword(portfolioId, password);
      const isViewer = loggedInAs && await isAllowedViewer(portfolioId, loggedInAs);

      if (!hasPassword && !isViewer) {
        res.status(200).json({
          portfolioId,
          displayName: portfolio.display_name,
          isPrivate: false,
          visibility: portfolio.visibility,
          requiresAuth: true,
        });
        return;
      }
    }
    // Public portfolios: no auth required

    // Get holdings from database
    const dbHoldings = await getHoldings(portfolioId);

    // Separate tradeable and static holdings
    const tradeableHoldings = dbHoldings.filter((h) => !h.is_static);
    const staticHoldings = dbHoldings.filter((h) => h.is_static);

    // Fetch fresh prices from FMP for all tradeable holdings
    const tickers = tradeableHoldings.map((h) => h.ticker);
    const quotes = await getMultipleQuotes(tickers);

    // Build holdings response
    const holdings: Holding[] = [];

    // Process tradeable holdings
    for (const holding of tradeableHoldings) {
      const quote = quotes.get(holding.ticker);
      if (!quote) {
        console.warn(`No price data for ${holding.ticker}`);
        continue;
      }

      const value = holding.shares * quote.currentPrice;
      const previousValue = holding.shares * quote.previousClose;
      const dayChange = value - previousValue;
      const dayChangePercent =
        previousValue > 0 ? (dayChange / previousValue) * 100 : 0;

      // Calculate profit/loss if cost basis exists
      const costBasis = holding.cost_basis;
      const profitLoss = costBasis !== null ? value - costBasis : null;
      const profitLossPercent = costBasis !== null && costBasis > 0
        ? (profitLoss! / costBasis) * 100
        : null;

      holdings.push({
        ticker: holding.ticker,
        name: holding.name,
        shares: holding.shares,
        currentPrice: quote.currentPrice,
        previousClose: quote.previousClose,
        value,
        allocation: 0, // Calculated later
        dayChange,
        dayChangePercent,
        isStatic: false,
        instrumentType: holding.instrument_type || 'Other',
        costBasis,
        profitLoss,
        profitLossPercent,
      });
    }

    // Process static holdings
    for (const holding of staticHoldings) {
      const value = holding.static_value || 0;

      // Calculate profit/loss if cost basis exists
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
    }

    // Calculate totals and allocations
    const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
    const totalDayChange = holdings.reduce((sum, h) => sum + h.dayChange, 0);
    const previousTotalValue = totalValue - totalDayChange;
    const totalDayChangePercent =
      previousTotalValue > 0 ? (totalDayChange / previousTotalValue) * 100 : 0;

    // Set allocations
    for (const holding of holdings) {
      holding.allocation = totalValue > 0 ? (holding.value / totalValue) * 100 : 0;
    }

    // Sort by value descending
    holdings.sort((a, b) => b.value - a.value);

    // Calculate total gain % from holdings with cost basis
    let totalCostBasis = 0;
    let totalValueWithCostBasis = 0;
    for (const holding of holdings) {
      if (holding.costBasis !== null) {
        totalCostBasis += holding.costBasis;
        totalValueWithCostBasis += holding.value;
      }
    }
    const totalGain = totalCostBasis > 0
      ? totalValueWithCostBasis - totalCostBasis
      : null;
    const totalGainPercent = totalCostBasis > 0
      ? ((totalValueWithCostBasis - totalCostBasis) / totalCostBasis) * 100
      : null;

    // Fetch S&P 500 benchmark data from FMP
    let benchmark: BenchmarkData | null = null;
    try {
      const spyQuote = await getQuote(BENCHMARK_TICKER);
      if (spyQuote && spyQuote.previousClose > 0) {
        benchmark = {
          ticker: BENCHMARK_TICKER,
          name: BENCHMARK_NAME,
          dayChangePercent: spyQuote.changePercent,
        };
      }
    } catch (error) {
      console.warn('Could not fetch benchmark data:', error);
    }

    // Fetch viewers if selective visibility
    const viewers = portfolio.visibility === 'selective' ? await getPortfolioViewers(portfolioId) : undefined;

    const response: PortfolioResponse = {
      portfolioId,
      displayName: portfolio.display_name,
      totalValue,
      totalDayChange,
      totalDayChangePercent,
      totalGain,
      totalGainPercent,
      holdings,
      lastUpdated: new Date().toISOString(),
      marketStatus: getMarketStatus(),
      benchmark,
      isPrivate: portfolio.visibility === 'private',
      visibility: portfolio.visibility,
      viewers,
    };

    // Don't cache - portfolio data changes frequently and should always be fresh
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(response);
  } catch (error) {
    console.error('Portfolio API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
