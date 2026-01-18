import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import {
  getPortfolios,
  getPortfolio,
  getPortfolioCount,
  createPortfolio,
  deletePortfolio,
  setHoldings,
  verifyPortfolioPassword,
  updatePortfolioSettings,
  isAllowedViewer,
  setPortfolioViewers,
  getAllPortfolioSnapshots,
  deletePortfolioSnapshot,
  recordSnapshotError,
  type Visibility,
} from './lib/db.js';
import { getSymbolInfo, getQuote } from './lib/yahoo.js';
import { refreshPortfolioSnapshot } from './lib/snapshot.js';
import {
  getAllSnapshotsFromRedis,
  getPortfoliosFromRedis,
  setPortfoliosInRedis,
  getPortfolioCountFromRedis,
  setPortfolioCountInRedis,
  invalidatePortfoliosListCache,
  incrementPortfolioCount,
  decrementPortfolioCount,
  deleteSnapshotFromRedis,
  deletePortfolioFromRedis,
  setPortfolioInRedis,
} from './lib/redis.js';

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
// Note: This still calls live APIs because we need current price to calculate shares from dollar value
async function classifyHoldings(
  holdings: HoldingInput[]
): Promise<ClassificationResult> {
  const tradeable: ClassifiedHolding[] = [];
  const staticHoldings: ClassifiedHolding[] = [];

  for (const holding of holdings) {
    try {
      // Try Yahoo Finance for all symbols (stocks, ETFs, mutual funds)
      const quote = await getQuote(holding.ticker);
      if (quote && quote.currentPrice > 0) {
        const symbolInfo = await getSymbolInfo(holding.ticker).catch(() => null);
        tradeable.push({
          ...holding,
          isStatic: false,
          name: symbolInfo?.name || holding.ticker,
          instrumentType: symbolInfo?.instrumentType || 'Other',
          price: quote.currentPrice,
        });
        continue;
      }
    } catch (e) {
      console.error(`Error classifying ${holding.ticker}:`, e);
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
  const requestStart = Date.now();

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
      // List all portfolios with summary data from pre-computed snapshots
      const loggedInAs = req.query.logged_in_as as string | undefined;

      // Get portfolios - try Redis first, then DB
      let t0 = Date.now();
      let portfolios = await getPortfoliosFromRedis();
      console.log(`[TIMING] portfolios.ts getPortfoliosFromRedis: ${Date.now() - t0}ms (found ${portfolios?.length ?? 0})`);
      if (!portfolios) {
        t0 = Date.now();
        portfolios = await getPortfolios();
        console.log(`[TIMING] portfolios.ts getPortfolios (fallback): ${Date.now() - t0}ms`);
        // Cache for next time
        await setPortfoliosInRedis(portfolios);
      }

      // Get count - try Redis first, then DB
      t0 = Date.now();
      let count = await getPortfolioCountFromRedis();
      console.log(`[TIMING] portfolios.ts getPortfolioCountFromRedis: ${Date.now() - t0}ms (found ${count})`);
      if (count === null) {
        t0 = Date.now();
        count = await getPortfolioCount();
        console.log(`[TIMING] portfolios.ts getPortfolioCount (fallback): ${Date.now() - t0}ms`);
        // Cache for next time
        await setPortfolioCountInRedis(count);
      }

      // Get all snapshots - try Redis first, fall back to DB
      t0 = Date.now();
      let snapshots = await getAllSnapshotsFromRedis();
      console.log(`[TIMING] portfolios.ts getAllSnapshotsFromRedis: ${Date.now() - t0}ms (found ${snapshots.length})`);

      if (snapshots.length === 0) {
        t0 = Date.now();
        snapshots = await getAllPortfolioSnapshots();
        console.log(`[TIMING] portfolios.ts getAllPortfolioSnapshots (fallback): ${Date.now() - t0}ms`);
      }
      const snapshotMap = new Map(snapshots.map((s) => [s.portfolio_id, s]));

      // Build response with visibility checks
      const portfoliosWithSummary = await Promise.all(
        portfolios.map(async (portfolio) => {
          // Determine if values should be hidden
          let hideValues = false;
          if (portfolio.visibility === 'private') {
            // Private: always hide unless viewer is the owner
            hideValues = loggedInAs?.toLowerCase() !== portfolio.id.toLowerCase();
          } else if (portfolio.visibility === 'selective') {
            // Selective: hide unless viewer is owner or in allowed list
            const isOwner = loggedInAs?.toLowerCase() === portfolio.id.toLowerCase();
            const isAllowed = loggedInAs ? await isAllowedViewer(portfolio.id, loggedInAs) : false;
            hideValues = !isOwner && !isAllowed;
          }

          // If hiding values, skip returning values
          if (hideValues) {
            return {
              ...portfolio,
              totalValue: null,
              dayChange: null,
              dayChangePercent: null,
            };
          }

          // Get pre-computed snapshot
          const snapshot = snapshotMap.get(portfolio.id);
          if (snapshot) {
            return {
              ...portfolio,
              totalValue: snapshot.total_value,
              dayChange: snapshot.day_change,
              dayChangePercent: snapshot.day_change_percent,
              lastUpdated: snapshot.updated_at,
            };
          }

          // No snapshot yet
          return {
            ...portfolio,
            totalValue: 0,
            dayChange: 0,
            dayChangePercent: 0,
          };
        })
      );

      console.log(`[TIMING] portfolios.ts GET total: ${Date.now() - requestStart}ms`);
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
      const { id, displayName, password, holdings: holdingsInput, visibility, viewers } = req.body;
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
      const classification = await classifyHoldings(parsedHoldings);

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
      const portfolioCount = await getPortfolioCount();
      if (portfolioCount >= MAX_PORTFOLIOS) {
        res.status(400).json({ error: 'Maximum number of portfolios reached (10)' });
        return;
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
      const validVisibility: Visibility = ['public', 'private', 'selective'].includes(visibility) ? visibility : 'public';
      await createPortfolio(cleanId, password, displayName, validVisibility);
      await setHoldings(cleanId, dbHoldings);

      // Set viewers if selective visibility
      if (validVisibility === 'selective' && Array.isArray(viewers)) {
        const validViewers = viewers.filter((v: unknown) => typeof v === 'string').map((v: string) => v.toLowerCase());
        await setPortfolioViewers(cleanId, validViewers);
      }

      // Invalidate Redis caches
      await invalidatePortfoliosListCache();
      await incrementPortfolioCount();

      // Trigger snapshot refresh for the new portfolio (non-blocking)
      refreshPortfolioSnapshot(cleanId).catch(async (err) => {
        console.error(`Failed to refresh snapshot for ${cleanId}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        await recordSnapshotError(cleanId, errorMessage).catch((recordErr) =>
          console.error(`Failed to record snapshot error for ${cleanId}:`, recordErr)
        );
      });

      res.status(201).json({
        id: cleanId,
        message: 'Portfolio created successfully',
      });
      return;
    }

    if (req.method === 'PUT') {
      // Update existing portfolio (or preview classification)
      const { id, password, holdings: holdingsInput, visibility, viewers, newPassword } = req.body;
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
      const classification = await classifyHoldings(parsedHoldings);

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

      // Update portfolio settings (visibility and/or password)
      const settings: { is_private?: boolean; visibility?: Visibility; password_hash?: string } = {};
      if (visibility && ['public', 'private', 'selective'].includes(visibility)) {
        settings.visibility = visibility as Visibility;
        settings.is_private = visibility === 'private';
      }
      if (newPassword && typeof newPassword === 'string' && newPassword.length >= 4) {
        settings.password_hash = await bcrypt.hash(newPassword, 10);
      }
      if (Object.keys(settings).length > 0) {
        await updatePortfolioSettings(id, settings);
      }

      // Update viewers if selective visibility
      if (visibility === 'selective' && Array.isArray(viewers)) {
        const validViewers = viewers.filter((v: unknown) => typeof v === 'string').map((v: string) => v.toLowerCase());
        await setPortfolioViewers(id, validViewers);
      } else if (visibility && visibility !== 'selective') {
        // Clear viewers if switching away from selective
        await setPortfolioViewers(id, []);
      }

      await setHoldings(id, dbHoldings);

      // Invalidate Redis caches (visibility or display_name may have changed)
      await invalidatePortfoliosListCache();
      await deletePortfolioFromRedis(id); // Will be re-cached on next read

      // Trigger snapshot refresh for the updated portfolio (non-blocking)
      refreshPortfolioSnapshot(id).catch(async (err) => {
        console.error(`Failed to refresh snapshot for ${id}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        await recordSnapshotError(id, errorMessage).catch((recordErr) =>
          console.error(`Failed to record snapshot error for ${id}:`, recordErr)
        );
      });

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

      // Delete snapshot first (before portfolio due to FK constraint)
      await deletePortfolioSnapshot(id);
      await deletePortfolio(id);

      // Invalidate Redis caches
      await invalidatePortfoliosListCache();
      await decrementPortfolioCount();
      await deletePortfolioFromRedis(id);
      await deleteSnapshotFromRedis(id);

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
