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
  updatePortfolioSettings,
} from './lib/db.js';
import { getMultipleQuotes, getSymbolInfo, isMutualFund, getMutualFundQuote, getQuote } from './lib/finnhub.js';

const MAX_PORTFOLIOS = 10;

interface HoldingInput {
  ticker: string;
  value: number; // in dollars
  costBasis?: number; // in dollars (optional)
}

interface ParsedHoldings {
  holdings: HoldingInput[];
  errors: string[];
}

interface ClassifiedHolding extends HoldingInput {
  isStatic: boolean;
  name?: string;
  instrumentType?: string;
  price?: number;
  costBasis?: number;
}

interface ClassificationResult {
  tradeable: ClassifiedHolding[];
  static: ClassifiedHolding[];
}

function parseHoldingsInput(input: string): ParsedHoldings {
  const holdingsMap = new Map<string, { value: number; costBasis?: number }>(); // Aggregate by ticker
  const errors: string[] = [];
  const lines = input.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Support formats:
    // "VUG: 4174.9" - basic format
    // "VUG: 4174.9 @ 3500.0" - with cost basis
    // "Real Estate: 1526.5" - static asset
    // "VUG 4174.9" - space separator (single-word ticker only)

    // First try colon format with optional @ cost basis
    let match = trimmed.match(/^(.+?):\s*(\d+(?:\.\d+)?)\s*(?:@\s*(\d+(?:\.\d+)?))?$/);
    if (!match) {
      // Fallback: single-word ticker with space or comma separator (no cost basis support)
      match = trimmed.match(/^([A-Za-z0-9.]+)[\s,]+(\d+(?:\.\d+)?)$/);
    }

    if (match) {
      const ticker = match[1].trim();
      const value = parseFloat(match[2]) * 1000; // Convert from thousands to dollars
      const costBasis = match[3] ? parseFloat(match[3]) * 1000 : undefined;

      // Aggregate duplicate tickers by summing their values
      const existing = holdingsMap.get(ticker);
      if (existing) {
        holdingsMap.set(ticker, {
          value: existing.value + value,
          costBasis: existing.costBasis !== undefined || costBasis !== undefined
            ? (existing.costBasis || 0) + (costBasis || 0)
            : undefined,
        });
      } else {
        holdingsMap.set(ticker, { value, costBasis });
      }
    } else {
      errors.push(`Could not parse line: "${trimmed}"`);
    }
  }

  // Convert map to array
  const holdings: HoldingInput[] = Array.from(holdingsMap.entries()).map(
    ([ticker, data]) => ({ ticker, value: data.value, costBasis: data.costBasis })
  );

  return { holdings, errors };
}

// Determine instrument type for static holdings based on name
function getStaticInstrumentType(ticker: string): string {
  const lowerTicker = ticker.toLowerCase();
  if (lowerTicker.includes('cash') || lowerTicker.includes('savings') || lowerTicker.includes('checking')) {
    return 'Cash';
  } else if (lowerTicker.includes('real estate')) {
    return 'Real Estate';
  } else if (lowerTicker.includes('crypto')) {
    return 'Crypto';
  } else if (lowerTicker.includes('bonds')) {
    return 'Bonds';
  }
  return 'Other';
}

// Smart classification: try price lookups, fallback to static
async function classifyHoldings(
  holdings: HoldingInput[],
  priceMap: Map<string, { current_price: number; previous_close: number }>
): Promise<ClassificationResult> {
  const tradeable: ClassifiedHolding[] = [];
  const staticHoldings: ClassifiedHolding[] = [];

  for (const holding of holdings) {
    // Check if we already have a cached price
    const cachedPrice = priceMap.get(holding.ticker);
    if (cachedPrice && cachedPrice.current_price > 0) {
      const symbolInfo = await getSymbolInfo(holding.ticker);
      tradeable.push({
        ...holding,
        isStatic: false,
        name: symbolInfo?.name || holding.ticker,
        instrumentType: symbolInfo?.instrumentType || 'Other',
        price: cachedPrice.current_price,
      });
      continue;
    }

    // Try FMP for stocks/ETFs
    try {
      const quote = await getQuote(holding.ticker);
      if (quote && quote.currentPrice > 0) {
        const symbolInfo = await getSymbolInfo(holding.ticker);
        tradeable.push({
          ...holding,
          isStatic: false,
          name: symbolInfo?.name || holding.ticker,
          instrumentType: symbolInfo?.instrumentType || 'Other',
          price: quote.currentPrice,
        });
        // Update price map for later use
        priceMap.set(holding.ticker, {
          current_price: quote.currentPrice,
          previous_close: quote.previousClose,
        });
        continue;
      }
    } catch (e) {
      // FMP lookup failed, try CNBC for mutual funds
    }

    // Try CNBC for mutual funds
    if (isMutualFund(holding.ticker)) {
      try {
        const mfQuote = await getMutualFundQuote(holding.ticker);
        if (mfQuote && mfQuote.price > 0) {
          tradeable.push({
            ...holding,
            isStatic: false,
            name: holding.ticker,
            instrumentType: 'Mutual Fund',
            price: mfQuote.price,
          });
          priceMap.set(holding.ticker, {
            current_price: mfQuote.price,
            previous_close: mfQuote.previousClose,
          });
          continue;
        }
      } catch (e) {
        // CNBC lookup failed
      }
    }

    // Fallback to static
    staticHoldings.push({
      ...holding,
      isStatic: true,
      name: holding.ticker,
      instrumentType: getStaticInstrumentType(holding.ticker),
    });
  }

  return { tradeable, static: staticHoldings };
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
            totalValue: portfolio.is_private ? null : totalValue,
            dayChange: portfolio.is_private ? null : totalDayChange,
            dayChangePercent: portfolio.is_private ? null : dayChangePercent,
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
      // Create new portfolio (or preview classification)
      const { id, displayName, password, holdings: holdingsInput, isPrivate } = req.body;
      const isPreview = req.query.preview === 'true';

      // Parse holdings first (needed for both preview and create)
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

      // Use smart classification to determine which holdings are tradeable vs static
      const priceMap = await getCachedPrices();
      const classification = await classifyHoldings(parsedHoldings, priceMap);

      // If preview mode, return the classification without saving
      if (isPreview) {
        res.status(200).json({
          preview: true,
          tradeable: classification.tradeable.map((h) => ({
            ticker: h.ticker,
            value: h.value,
            name: h.name,
            instrumentType: h.instrumentType,
            price: h.price,
          })),
          static: classification.static.map((h) => ({
            ticker: h.ticker,
            value: h.value,
            instrumentType: h.instrumentType,
          })),
        });
        return;
      }

      // Full create: validate all fields
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

      // Update price cache for tradeable holdings
      for (const holding of classification.tradeable) {
        if (holding.price) {
          const cached = priceMap.get(holding.ticker);
          if (!cached) {
            await updatePriceCache(
              holding.ticker,
              holding.price,
              priceMap.get(holding.ticker)?.previous_close || holding.price
            );
          }
        }
      }

      // Build database holdings from classification
      const dbHoldings = [];

      for (const holding of classification.tradeable) {
        if (!holding.price || holding.price === 0) {
          res.status(400).json({ error: `Could not get price for ${holding.ticker}` });
          return;
        }
        const shares = holding.value / holding.price;
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares,
          is_static: false,
          static_value: null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      for (const holding of classification.static) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.value,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      // Create portfolio and add holdings
      await createPortfolio(cleanId, password, displayName, isPrivate ?? false);
      await setHoldings(cleanId, dbHoldings);

      res.status(201).json({
        id: cleanId,
        message: 'Portfolio created successfully',
      });
      return;
    }

    if (req.method === 'PUT') {
      // Update existing portfolio (or preview classification)
      const { id, password, holdings: holdingsInput, isPrivate } = req.body;
      const isPreview = req.query.preview === 'true';

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

      // Parse holdings
      const { holdings: parsedHoldings, errors: parseErrors } = parseHoldingsInput(holdingsInput);
      if (parseErrors.length > 0) {
        res.status(400).json({ error: 'Failed to parse holdings', details: parseErrors });
        return;
      }

      if (parsedHoldings.length === 0) {
        res.status(400).json({ error: 'At least one holding is required' });
        return;
      }

      // Use smart classification to determine which holdings are tradeable vs static
      const priceMap = await getCachedPrices();
      const classification = await classifyHoldings(parsedHoldings, priceMap);

      // If preview mode, return the classification without saving
      if (isPreview) {
        res.status(200).json({
          preview: true,
          tradeable: classification.tradeable.map((h) => ({
            ticker: h.ticker,
            value: h.value,
            name: h.name,
            instrumentType: h.instrumentType,
            price: h.price,
          })),
          static: classification.static.map((h) => ({
            ticker: h.ticker,
            value: h.value,
            instrumentType: h.instrumentType,
          })),
        });
        return;
      }

      // Update price cache for tradeable holdings
      for (const holding of classification.tradeable) {
        if (holding.price) {
          const cached = priceMap.get(holding.ticker);
          if (!cached) {
            await updatePriceCache(
              holding.ticker,
              holding.price,
              priceMap.get(holding.ticker)?.previous_close || holding.price
            );
          }
        }
      }

      // Build database holdings from classification
      const dbHoldings = [];

      for (const holding of classification.tradeable) {
        if (!holding.price || holding.price === 0) {
          res.status(400).json({ error: `Could not get price for ${holding.ticker}` });
          return;
        }
        const shares = holding.value / holding.price;
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares,
          is_static: false,
          static_value: null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      for (const holding of classification.static) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.value,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      // Update privacy setting if provided
      if (typeof isPrivate === 'boolean') {
        await updatePortfolioSettings(id, { is_private: isPrivate });
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
