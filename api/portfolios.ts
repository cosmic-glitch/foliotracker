import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getPortfolios,
  getPortfolio,
  getPortfolioCount,
  createPortfolio,
  deletePortfolio,
  setHoldings,
  getHoldings,
  verifyPortfolioPassword,
  getCachedPrices,
  updatePriceCache,
} from './lib/db.js';
import { getMultipleQuotes, getSymbolInfo, isMutualFund, getMutualFundQuote } from './lib/finnhub.js';

const MAX_PORTFOLIOS = 10;

// Static holdings that should not be fetched from Finnhub (non-ticker names)
const STATIC_HOLDINGS = ['cash', 'real estate', 'other cash', 'crypto', 'bonds', 'savings', 'checking'];

interface HoldingInput {
  ticker: string;
  value: number; // in dollars
}

interface ParsedHoldings {
  holdings: HoldingInput[];
  errors: string[];
}

function parseHoldingsInput(input: string): ParsedHoldings {
  const holdingsMap = new Map<string, number>(); // Aggregate by ticker
  const errors: string[] = [];
  const lines = input.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Support formats: "VUG: 4174.9", "Real Estate: 1526.5", "VUG 4174.9"
    // First try colon format (allows spaces in name)
    let match = trimmed.match(/^(.+?):\s*(\d+(?:\.\d+)?)$/);
    if (!match) {
      // Fallback: single-word ticker with space or comma separator
      match = trimmed.match(/^([A-Za-z0-9.]+)[\s,]+(\d+(?:\.\d+)?)$/);
    }

    if (match) {
      const ticker = match[1].trim();
      const value = parseFloat(match[2]) * 1000; // Convert from thousands to dollars
      // Aggregate duplicate tickers by summing their values
      const existing = holdingsMap.get(ticker) || 0;
      holdingsMap.set(ticker, existing + value);
    } else {
      errors.push(`Could not parse line: "${trimmed}"`);
    }
  }

  // Convert map to array
  const holdings: HoldingInput[] = Array.from(holdingsMap.entries()).map(
    ([ticker, value]) => ({ ticker, value })
  );

  return { holdings, errors };
}

function isStaticHolding(ticker: string): boolean {
  // Check if it's a known static holding name
  if (STATIC_HOLDINGS.includes(ticker.toLowerCase())) {
    return true;
  }
  // Check if it looks like a ticker (uppercase letters, numbers, dots only, max 5 chars)
  const tickerPattern = /^[A-Z0-9.]{1,5}$/;
  return !tickerPattern.test(ticker.toUpperCase());
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      // List all portfolios with summary data
      const portfolios = await getPortfolios();
      const count = await getPortfolioCount();
      const cachedPrices = await getCachedPrices();

      // Calculate summary for each portfolio
      const portfoliosWithSummary = await Promise.all(
        portfolios.map(async (portfolio) => {
          const holdings = await getHoldings(portfolio.id);

          let totalValue = 0;
          let totalDayChange = 0;

          for (const holding of holdings) {
            if (holding.is_static) {
              totalValue += holding.static_value || 0;
            } else {
              const price = cachedPrices.get(holding.ticker);
              if (price) {
                const value = holding.shares * price.current_price;
                const previousValue = holding.shares * price.previous_close;
                totalValue += value;
                totalDayChange += value - previousValue;
              }
            }
          }

          const previousTotalValue = totalValue - totalDayChange;
          const dayChangePercent = previousTotalValue > 0
            ? (totalDayChange / previousTotalValue) * 100
            : 0;

          return {
            ...portfolio,
            totalValue,
            dayChange: totalDayChange,
            dayChangePercent,
          };
        })
      );

      res.status(200).json({
        portfolios: portfoliosWithSummary,
        count,
        maxPortfolios: MAX_PORTFOLIOS,
        canCreate: count < MAX_PORTFOLIOS,
      });
      return;
    }

    if (req.method === 'POST') {
      // Create new portfolio
      const { id, displayName, password, holdings: holdingsInput } = req.body;

      // Validate ID
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Portfolio ID is required' });
        return;
      }

      const cleanId = id.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (cleanId.length < 2 || cleanId.length > 20) {
        res.status(400).json({ error: 'Portfolio ID must be 2-20 characters (letters, numbers, hyphens)' });
        return;
      }

      // Check if ID already exists
      const existing = await getPortfolio(cleanId);
      if (existing) {
        res.status(400).json({ error: 'Portfolio ID already taken' });
        return;
      }

      // Validate password
      if (!password || typeof password !== 'string' || password.length < 4) {
        res.status(400).json({ error: 'Password must be at least 4 characters' });
        return;
      }

      // Check portfolio limit
      const count = await getPortfolioCount();
      if (count >= MAX_PORTFOLIOS) {
        res.status(400).json({ error: 'Maximum number of portfolios reached (10)' });
        return;
      }

      // Parse holdings
      if (!holdingsInput || typeof holdingsInput !== 'string') {
        res.status(400).json({ error: 'Holdings data is required' });
        return;
      }

      const { holdings: parsedHoldings, errors: parseErrors } = parseHoldingsInput(holdingsInput);
      if (parseErrors.length > 0) {
        res.status(400).json({ error: 'Failed to parse holdings', details: parseErrors });
        return;
      }

      if (parsedHoldings.length === 0) {
        res.status(400).json({ error: 'At least one holding is required' });
        return;
      }

      // Separate tradeable and static holdings
      const tradeableHoldings = parsedHoldings.filter((h) => !isStaticHolding(h.ticker));
      const staticHoldings = parsedHoldings.filter((h) => isStaticHolding(h.ticker));

      // Separate mutual funds from stocks/ETFs
      const mutualFundHoldings = tradeableHoldings.filter((h) => isMutualFund(h.ticker));
      const stockEtfHoldings = tradeableHoldings.filter((h) => !isMutualFund(h.ticker));

      // Fetch current prices for stock/ETF holdings from Finnhub
      const stockEtfTickers = stockEtfHoldings.map((h) => h.ticker);
      let priceMap = await getCachedPrices();

      // Fetch missing stock/ETF prices from Finnhub
      const tickersToFetch = stockEtfTickers.filter((t) => !priceMap.has(t));
      if (tickersToFetch.length > 0) {
        const quotes = await getMultipleQuotes(tickersToFetch);
        for (const [ticker, quote] of quotes) {
          await updatePriceCache(ticker, quote.c, quote.pc);
          priceMap.set(ticker, {
            ticker,
            current_price: quote.c,
            previous_close: quote.pc,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Fetch mutual fund prices from CNBC
      for (const holding of mutualFundHoldings) {
        if (!priceMap.has(holding.ticker)) {
          const quote = await getMutualFundQuote(holding.ticker);
          if (quote) {
            await updatePriceCache(holding.ticker, quote.price, quote.previousClose);
            priceMap.set(holding.ticker, {
              ticker: holding.ticker,
              current_price: quote.price,
              previous_close: quote.previousClose,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      // Calculate share counts and fetch company names + instrument types
      const dbHoldings = [];

      for (const holding of [...stockEtfHoldings, ...mutualFundHoldings]) {
        const price = priceMap.get(holding.ticker);
        if (!price || price.current_price === 0) {
          res.status(400).json({ error: `Could not get price for ${holding.ticker}` });
          return;
        }
        const shares = holding.value / price.current_price;
        const symbolInfo = await getSymbolInfo(holding.ticker);
        dbHoldings.push({
          ticker: holding.ticker,
          name: symbolInfo?.name || holding.ticker,
          shares,
          is_static: false,
          static_value: null,
          instrument_type: symbolInfo?.instrumentType || 'Other',
        });
      }

      for (const holding of staticHoldings) {
        // Determine instrument type for static holdings based on ticker name
        let instrumentType = 'Other';
        const lowerTicker = holding.ticker.toLowerCase();
        if (lowerTicker.includes('cash') || lowerTicker.includes('savings') || lowerTicker.includes('checking')) {
          instrumentType = 'Cash';
        } else if (lowerTicker.includes('real estate')) {
          instrumentType = 'Real Estate';
        } else if (lowerTicker.includes('crypto')) {
          instrumentType = 'Crypto';
        } else if (lowerTicker.includes('bonds')) {
          instrumentType = 'Bonds';
        }

        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.value,
          instrument_type: instrumentType,
        });
      }

      // Create portfolio and add holdings
      await createPortfolio(cleanId, password, displayName);
      await setHoldings(cleanId, dbHoldings);

      res.status(201).json({
        id: cleanId,
        message: 'Portfolio created successfully',
      });
      return;
    }

    if (req.method === 'PUT') {
      // Update existing portfolio
      const { id, password, holdings: holdingsInput } = req.body;

      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Portfolio ID is required' });
        return;
      }

      // Verify password
      const isValid = await verifyPortfolioPassword(id, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }

      // Parse and update holdings (same logic as POST)
      const { holdings: parsedHoldings, errors: parseErrors } = parseHoldingsInput(holdingsInput);
      if (parseErrors.length > 0) {
        res.status(400).json({ error: 'Failed to parse holdings', details: parseErrors });
        return;
      }

      if (parsedHoldings.length === 0) {
        res.status(400).json({ error: 'At least one holding is required' });
        return;
      }

      const tradeableHoldings = parsedHoldings.filter((h) => !isStaticHolding(h.ticker));
      const staticHoldings = parsedHoldings.filter((h) => isStaticHolding(h.ticker));

      // Separate mutual funds from stocks/ETFs
      const mutualFundHoldings = tradeableHoldings.filter((h) => isMutualFund(h.ticker));
      const stockEtfHoldings = tradeableHoldings.filter((h) => !isMutualFund(h.ticker));

      const stockEtfTickers = stockEtfHoldings.map((h) => h.ticker);
      let priceMap = await getCachedPrices();

      // Fetch missing stock/ETF prices from Finnhub
      const tickersToFetch = stockEtfTickers.filter((t) => !priceMap.has(t));
      if (tickersToFetch.length > 0) {
        const quotes = await getMultipleQuotes(tickersToFetch);
        for (const [ticker, quote] of quotes) {
          await updatePriceCache(ticker, quote.c, quote.pc);
          priceMap.set(ticker, {
            ticker,
            current_price: quote.c,
            previous_close: quote.pc,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // Fetch mutual fund prices from CNBC
      for (const holding of mutualFundHoldings) {
        if (!priceMap.has(holding.ticker)) {
          const quote = await getMutualFundQuote(holding.ticker);
          if (quote) {
            await updatePriceCache(holding.ticker, quote.price, quote.previousClose);
            priceMap.set(holding.ticker, {
              ticker: holding.ticker,
              current_price: quote.price,
              previous_close: quote.previousClose,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      const dbHoldings = [];

      for (const holding of [...stockEtfHoldings, ...mutualFundHoldings]) {
        const price = priceMap.get(holding.ticker);
        if (!price || price.current_price === 0) {
          res.status(400).json({ error: `Could not get price for ${holding.ticker}` });
          return;
        }
        const shares = holding.value / price.current_price;
        const symbolInfo = await getSymbolInfo(holding.ticker);
        dbHoldings.push({
          ticker: holding.ticker,
          name: symbolInfo?.name || holding.ticker,
          shares,
          is_static: false,
          static_value: null,
          instrument_type: symbolInfo?.instrumentType || 'Other',
        });
      }

      for (const holding of staticHoldings) {
        // Determine instrument type for static holdings based on ticker name
        let instrumentType = 'Other';
        const lowerTicker = holding.ticker.toLowerCase();
        if (lowerTicker.includes('cash') || lowerTicker.includes('savings') || lowerTicker.includes('checking')) {
          instrumentType = 'Cash';
        } else if (lowerTicker.includes('real estate')) {
          instrumentType = 'Real Estate';
        } else if (lowerTicker.includes('crypto')) {
          instrumentType = 'Crypto';
        } else if (lowerTicker.includes('bonds')) {
          instrumentType = 'Bonds';
        }

        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.value,
          instrument_type: instrumentType,
        });
      }

      await setHoldings(id, dbHoldings);

      res.status(200).json({
        id,
        message: 'Portfolio updated successfully',
      });
      return;
    }

    if (req.method === 'DELETE') {
      // Delete portfolio
      const { id, password } = req.body;

      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Portfolio ID is required' });
        return;
      }

      // Verify password
      const isValid = await verifyPortfolioPassword(id, password);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }

      await deletePortfolio(id);

      res.status(200).json({
        id,
        message: 'Portfolio deleted successfully',
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Portfolios API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
