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

// Legacy format (string-based input)
interface LegacyHoldingInput {
  ticker: string;
  value: number; // in dollars
  costBasis?: number; // in dollars (optional)
}

interface LegacyParsedHoldings {
  holdings: LegacyHoldingInput[];
  errors: string[];
}

// New structured format
interface TradeableHoldingInput {
  ticker: string;
  shares: number;
  costBasisPerShare?: number;
}

interface StaticHoldingInput {
  name: string;
  value: number;
}

interface StructuredHoldingsInput {
  tradeable: TradeableHoldingInput[];
  static: StaticHoldingInput[];
}

interface ClassifiedHolding {
  ticker: string;
  shares: number;
  isStatic: boolean;
  name?: string;
  instrumentType?: string;
  price?: number;
  costBasis?: number; // total cost basis
  staticValue?: number;
}

interface ClassificationResult {
  tradeable: ClassifiedHolding[];
  static: ClassifiedHolding[];
  errors: string[];
}

// Preview response types
interface TradeablePreview {
  ticker: string;
  shares: number;
  name: string;
  instrumentType: string;
  currentPrice: number;
  currentValue: number;
  costBasis: number | null;
  unrealizedGain: number | null;
  unrealizedGainPercent: number | null;
}

interface StaticPreview {
  name: string;
  value: number;
  instrumentType: string;
}

// Check if input is new structured format
function isStructuredInput(input: unknown): input is StructuredHoldingsInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'tradeable' in input &&
    'static' in input &&
    Array.isArray((input as StructuredHoldingsInput).tradeable) &&
    Array.isArray((input as StructuredHoldingsInput).static)
  );
}

// Parse legacy string-based input (for backward compatibility)
function parseLegacyHoldingsInput(input: string): LegacyParsedHoldings {
  const holdingsMap = new Map<string, { value: number; costBasis?: number }>();
  const errors: string[] = [];
  const lines = input.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = trimmed.match(/^(.+?):\s*(\d+(?:\.\d+)?)\s*(?:@\s*(\d+(?:\.\d+)?))?$/);
    if (!match) {
      match = trimmed.match(/^([A-Za-z0-9.]+)[\s,]+(\d+(?:\.\d+)?)$/);
    }

    if (match) {
      const ticker = match[1].trim();
      const value = parseFloat(match[2]) * 1000;
      const costBasis = match[3] ? parseFloat(match[3]) * 1000 : undefined;

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

  const holdings: LegacyHoldingInput[] = Array.from(holdingsMap.entries()).map(
    ([ticker, data]) => ({ ticker, value: data.value, costBasis: data.costBasis })
  );

  return { holdings, errors };
}

// Process structured input - validates tickers and gets current prices
async function processStructuredInput(input: StructuredHoldingsInput): Promise<ClassificationResult> {
  const tradeable: ClassifiedHolding[] = [];
  const staticHoldings: ClassifiedHolding[] = [];
  const errors: string[] = [];

  // Process tradeable holdings - validate each ticker
  for (const holding of input.tradeable) {
    if (!holding.ticker || holding.shares <= 0) {
      continue;
    }

    try {
      const quote = await getQuote(holding.ticker);
      if (quote && quote.currentPrice > 0) {
        const symbolInfo = await getSymbolInfo(holding.ticker).catch(() => null);
        const totalCostBasis = holding.costBasisPerShare
          ? holding.costBasisPerShare * holding.shares
          : undefined;

        tradeable.push({
          ticker: holding.ticker.toUpperCase(),
          shares: holding.shares,
          isStatic: false,
          name: symbolInfo?.name || holding.ticker,
          instrumentType: symbolInfo?.instrumentType || 'Other',
          price: quote.currentPrice,
          costBasis: totalCostBasis,
        });
      } else {
        errors.push(`Could not find ticker: ${holding.ticker}`);
      }
    } catch (e) {
      console.error(`Error looking up ${holding.ticker}:`, e);
      errors.push(`Could not find ticker: ${holding.ticker}`);
    }
  }

  // Process static holdings
  for (const holding of input.static) {
    if (!holding.name || holding.value <= 0) {
      continue;
    }

    staticHoldings.push({
      ticker: holding.name,
      shares: 1,
      isStatic: true,
      name: holding.name,
      instrumentType: getStaticInstrumentType(holding.name),
      staticValue: holding.value,
    });
  }

  return { tradeable, static: staticHoldings, errors };
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

// Legacy classification: try price lookups, fallback to static (for backward compatibility)
async function classifyLegacyHoldings(
  holdings: LegacyHoldingInput[]
): Promise<ClassificationResult> {
  const tradeable: ClassifiedHolding[] = [];
  const staticHoldings: ClassifiedHolding[] = [];
  const errors: string[] = [];

  for (const holding of holdings) {
    try {
      const quote = await getQuote(holding.ticker);
      if (quote && quote.currentPrice > 0) {
        const symbolInfo = await getSymbolInfo(holding.ticker).catch(() => null);
        const shares = holding.value / quote.currentPrice;
        tradeable.push({
          ticker: holding.ticker,
          shares,
          isStatic: false,
          name: symbolInfo?.name || holding.ticker,
          instrumentType: symbolInfo?.instrumentType || 'Other',
          price: quote.currentPrice,
          costBasis: holding.costBasis,
        });
        continue;
      }
    } catch (e) {
      console.error(`Error classifying ${holding.ticker}:`, e);
    }

    // Fallback to static
    staticHoldings.push({
      ticker: holding.ticker,
      shares: 1,
      isStatic: true,
      name: holding.ticker,
      instrumentType: getStaticInstrumentType(holding.ticker),
      staticValue: holding.value,
      costBasis: holding.costBasis,
    });
  }

  return { tradeable, static: staticHoldings, errors };
}

// Build preview response with detailed info
function buildPreviewResponse(classification: ClassificationResult): {
  preview: true;
  tradeable: TradeablePreview[];
  static: StaticPreview[];
  errors?: string[];
} {
  const tradeablePreview: TradeablePreview[] = classification.tradeable.map((h) => {
    const currentValue = h.shares * (h.price || 0);
    const unrealizedGain = h.costBasis ? currentValue - h.costBasis : null;
    const unrealizedGainPercent = h.costBasis && h.costBasis > 0
      ? ((currentValue - h.costBasis) / h.costBasis) * 100
      : null;

    return {
      ticker: h.ticker,
      shares: h.shares,
      name: h.name || h.ticker,
      instrumentType: h.instrumentType || 'Other',
      currentPrice: h.price || 0,
      currentValue,
      costBasis: h.costBasis ?? null,
      unrealizedGain,
      unrealizedGainPercent,
    };
  });

  const staticPreview: StaticPreview[] = classification.static.map((h) => ({
    name: h.name || h.ticker,
    value: h.staticValue || 0,
    instrumentType: h.instrumentType || 'Other',
  }));

  return {
    preview: true,
    tradeable: tradeablePreview,
    static: staticPreview,
    ...(classification.errors.length > 0 && { errors: classification.errors }),
  };
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

      // Validate holdings input
      if (!holdingsInput) {
        res.status(400).json({ error: 'Holdings data is required' });
        return;
      }

      let classification: ClassificationResult;

      // Check if structured or legacy format
      if (isStructuredInput(holdingsInput)) {
        // New structured format: { tradeable: [...], static: [...] }
        if (holdingsInput.tradeable.length === 0 && holdingsInput.static.length === 0) {
          res.status(400).json({ error: 'At least one holding is required' });
          return;
        }
        classification = await processStructuredInput(holdingsInput);
      } else if (typeof holdingsInput === 'string') {
        // Legacy string format
        const { holdings: parsedHoldings, errors: parseErrors } = parseLegacyHoldingsInput(holdingsInput);
        if (parseErrors.length > 0) {
          res.status(400).json({ error: 'Failed to parse holdings', details: parseErrors });
          return;
        }
        if (parsedHoldings.length === 0) {
          res.status(400).json({ error: 'At least one holding is required' });
          return;
        }
        classification = await classifyLegacyHoldings(parsedHoldings);
      } else {
        res.status(400).json({ error: 'Invalid holdings format' });
        return;
      }

      // If preview mode, return the enhanced preview
      if (isPreview) {
        res.status(200).json(buildPreviewResponse(classification));
        return;
      }

      // Check for validation errors
      if (classification.errors.length > 0) {
        res.status(400).json({ error: 'Some tickers could not be found', details: classification.errors });
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
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares: holding.shares,
          is_static: false,
          static_value: null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      for (const holding of classification.static) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.staticValue ?? null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: null,
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

      // Refresh snapshot (blocking) so data is ready when user is redirected
      try {
        await refreshPortfolioSnapshot(cleanId);
      } catch (err) {
        console.error(`Failed to refresh snapshot for ${cleanId}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        await recordSnapshotError(cleanId, errorMessage).catch((recordErr) =>
          console.error(`Failed to record snapshot error for ${cleanId}:`, recordErr)
        );
        // Continue - portfolio is created, snapshot will be retried by cron
      }

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

      // Validate holdings input
      if (!holdingsInput) {
        res.status(400).json({ error: 'Holdings data is required' });
        return;
      }

      let classification: ClassificationResult;

      // Check if structured or legacy format
      if (isStructuredInput(holdingsInput)) {
        // New structured format
        if (holdingsInput.tradeable.length === 0 && holdingsInput.static.length === 0) {
          res.status(400).json({ error: 'At least one holding is required' });
          return;
        }
        classification = await processStructuredInput(holdingsInput);
      } else if (typeof holdingsInput === 'string') {
        // Legacy string format
        const { holdings: parsedHoldings, errors: parseErrors } = parseLegacyHoldingsInput(holdingsInput);
        if (parseErrors.length > 0) {
          res.status(400).json({ error: 'Failed to parse holdings', details: parseErrors });
          return;
        }
        if (parsedHoldings.length === 0) {
          res.status(400).json({ error: 'At least one holding is required' });
          return;
        }
        classification = await classifyLegacyHoldings(parsedHoldings);
      } else {
        res.status(400).json({ error: 'Invalid holdings format' });
        return;
      }

      // If preview mode, return the enhanced preview
      if (isPreview) {
        res.status(200).json(buildPreviewResponse(classification));
        return;
      }

      // Check for validation errors
      if (classification.errors.length > 0) {
        res.status(400).json({ error: 'Some tickers could not be found', details: classification.errors });
        return;
      }

      // Build database holdings from classification
      const dbHoldings = [];

      for (const holding of classification.tradeable) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares: holding.shares,
          is_static: false,
          static_value: null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: holding.costBasis ?? null,
        });
      }

      for (const holding of classification.static) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: holding.name || holding.ticker,
          shares: 1,
          is_static: true,
          static_value: holding.staticValue ?? null,
          instrument_type: holding.instrumentType || 'Other',
          cost_basis: null,
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

      // Refresh snapshot (blocking) so data is ready when user is redirected
      try {
        await refreshPortfolioSnapshot(id);
      } catch (err) {
        console.error(`Failed to refresh snapshot for ${id}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        await recordSnapshotError(id, errorMessage).catch((recordErr) =>
          console.error(`Failed to record snapshot error for ${id}:`, recordErr)
        );
        // Continue - portfolio is updated, snapshot will be retried by cron
      }

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
