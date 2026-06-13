import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import {
  getPortfolios,
  getPortfolio,
  getPortfolioCount,
  createPortfolio,
  deletePortfolio,
  setHoldings,
  authenticateRequest,
  verifySessionToken,
  deleteSessionsForPortfolio,
  updatePortfolioSettings,
  isAllowedViewer,
  setPortfolioViewers,
  getAllPortfolioSnapshots,
  deletePortfolioSnapshot,
  recordSnapshotError,
  getAnalyticsData,
  getPortfolioSnapshot,
  updateHotTake,
  clearChatHistory,
  type Visibility,
  type DbPortfolioListItem,
  type DbPortfolioSnapshot,
} from './_lib/db.js';
import { generateHotTake, type HoldingSummary } from './_lib/openai.js';
import { getSymbolInfo, getQuote } from './_lib/yahoo.js';
import { refreshPortfolioSnapshot } from './_lib/snapshot.js';
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
} from './_lib/redis.js';

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
    const value = Number(holding.value);
    if (!holding.name || !Number.isFinite(value) || value === 0) {
      continue;
    }

    staticHoldings.push({
      ticker: holding.name,
      shares: 1,
      isStatic: true,
      name: holding.name,
      instrumentType: getStaticInstrumentType(holding.name, value),
      staticValue: value,
    });
  }

  return { tradeable, static: staticHoldings, errors };
}

function hasClassifiedHoldings(classification: ClassificationResult): boolean {
  return classification.tradeable.length > 0 || classification.static.length > 0;
}

// Validate classified holdings against DB constraints BEFORE any write, so bad
// input surfaces in the preview response instead of throwing during setHoldings.
function validateClassifiedHoldings(classification: ClassificationResult): string[] {
  const errors: string[] = [];

  // holdings.ticker is varchar(20); static holdings store their name there.
  for (const h of classification.static) {
    if (h.ticker.length > 20) {
      errors.push(`Static holding name too long (max 20 characters): "${h.ticker}"`);
    }
  }
  for (const h of classification.tradeable) {
    if (h.ticker.length > 20) {
      errors.push(`Ticker too long (max 20 characters): "${h.ticker}"`);
    }
  }

  // Primary key is (portfolio_id, ticker) — duplicates break the write.
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const h of [...classification.tradeable, ...classification.static]) {
    if (seen.has(h.ticker) && !reported.has(h.ticker)) {
      errors.push(`Duplicate holding: "${h.ticker}" appears more than once`);
      reported.add(h.ticker);
    }
    seen.add(h.ticker);
  }

  return errors;
}

// Determine instrument type for static holdings based on name
function getStaticInstrumentType(ticker: string, value?: number): string {
  if (value !== undefined && value < 0) {
    return 'Liabilities';
  }

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
    value: h.staticValue ?? 0,
    instrumentType: h.instrumentType || 'Other',
  }));

  return {
    preview: true,
    tradeable: tradeablePreview,
    static: staticPreview,
    ...(classification.errors.length > 0 && { errors: classification.errors }),
  };
}

// --- Market movers (landing-page ticker strip) ---
// "The names swinging the most today, weighted by how widely they're held":
// every live (non-static, market-priced) stock or ETF that anyone holds is a
// candidate — there is no minimum-holders floor. Ranked by breadth × |move|,
// the product we treat as overall "noteworthiness": a name one person holds can
// outrank a widely-held one if its move is big enough (1 × 9% beats 3 × 2%),
// while a calm name only surfaces when many hold it. Mutual funds are excluded —
// they only price once a day.
//
// Names whose day move clears a per-type threshold — single-name stocks at ±2%,
// ETFs at ±1.5% (a diversified basket moves less, so a smaller swing is already
// notable) — are the "qualified" movers and lead the strip. To keep the first
// rows from coming up short on quiet days, we always return at least
// MOVER_MIN_COUNT names: when fewer than that qualify, the remaining slots are
// backfilled with the next-highest-ranked names by the same product (calmer
// ones). The genuine movers always lead.
//
// Two parallel rankings are returned — `regular` and `extended` — one per price
// basis. The extended move is the snapshot's `dayChangePercent` (its current
// price already carries the latest pre/post-market print); the regular move is
// recomputed from `regularMarketPrice` vs the same previous close, mirroring how
// usePortfolioData recomputes day change when Extended Hours is off. The strip
// renders whichever the viewer's Extended Hours toggle selects (default off ⇒
// regular), so the movers stay consistent with the holdings table and totals.
// Because the strip is ordered by |move|, the ranking — not just the displayed
// percentage — switches with the basis.

interface MarketMover {
  ticker: string;
  changePercent: number;
  // The handles (portfolio ids) holding this name, in creation order — the same
  // order and identity the landing-page Users list shows. The strip lists them
  // verbatim ("held by AB, CD") when they fit a row, and falls back to a count
  // ("held by 3 users") when they don't; either way holders.length is the count.
  holders: string[];
}

const MOVER_STOCK_MIN_ABS_CHANGE_PCT = 2;
const MOVER_ETF_MIN_ABS_CHANGE_PCT = 1.5;
// Floor on how many names the strip shows — one mover per row in the pill
// (keep in sync with DISPLAY_COUNT in src/components/MoversStrip.tsx).
const MOVER_MIN_COUNT = 3;
// Dual share classes count as one company for breadth; the canonical ticker
// (value side) is what the strip displays.
const SHARE_CLASS_ALIASES: Record<string, string> = { GOOGL: 'GOOG' };

function computeMarketMovers(
  portfolios: DbPortfolioListItem[],
  snapshotMap: Map<string, DbPortfolioSnapshot>
): { regular: MarketMover[]; extended: MarketMover[] } {
  const byTicker = new Map<
    string,
    {
      holders: Set<string>;
      changeExtended: number;
      changeRegular: number;
      fromCanonical: boolean;
      isEtf: boolean;
    }
  >();

  for (const portfolio of portfolios) {
    // Only portfolios whose tickers are already visible to everyone may
    // contribute (allocation_public=false keeps holdings private).
    const allocationPublic = portfolio.allocation_public ?? true;
    if (portfolio.visibility !== 'public' && !allocationPublic) continue;

    const snapshot = snapshotMap.get(portfolio.id);
    if (!snapshot) continue;

    for (const h of snapshot.holdings_json) {
      if (h.isStatic || !Number.isFinite(h.dayChangePercent)) continue;
      const eligible =
        h.instrumentType === 'Common Stock' || h.instrumentType === 'ETF';
      if (!eligible) continue;

      // Regular-hours move: regular-session close vs the same previous close
      // the extended move uses. Falls back to the (extended) current price when
      // a snapshot predates regularMarketPrice.
      const regPrice =
        Number.isFinite(h.regularMarketPrice) && h.regularMarketPrice > 0
          ? h.regularMarketPrice
          : h.currentPrice;
      const changeRegular =
        h.previousClose > 0
          ? ((regPrice - h.previousClose) / h.previousClose) * 100
          : 0;

      const canonical = SHARE_CLASS_ALIASES[h.ticker] ?? h.ticker;
      const isCanonical = h.ticker === canonical;
      let entry = byTicker.get(canonical);
      if (!entry) {
        entry = {
          holders: new Set(),
          changeExtended: h.dayChangePercent,
          changeRegular,
          fromCanonical: isCanonical,
          isEtf: h.instrumentType === 'ETF',
        };
        byTicker.set(canonical, entry);
      }
      entry.holders.add(portfolio.id);
      // Share classes drift slightly; report the canonical ticker's own move.
      if (isCanonical && !entry.fromCanonical) {
        entry.changeExtended = h.dayChangePercent;
        entry.changeRegular = changeRegular;
        entry.fromCanonical = true;
      }
    }
  }

  // Candidate pool: every held name (no minimum-holders floor), carrying both
  // price bases so each can be ranked independently.
  const candidates = Array.from(byTicker.entries()).map(([ticker, e]) => ({
    ticker,
    changeExtended: e.changeExtended,
    changeRegular: e.changeRegular,
    numPortfolios: e.holders.size,
    // Holder handles in insertion (creation) order — matches the Users list.
    holders: Array.from(e.holders),
    isEtf: e.isEtf,
  }));

  // Rank one price basis: breadth × |move| (the noteworthiness product). Names
  // clearing the per-type threshold lead; quiet days backfill by rank up to
  // MOVER_MIN_COUNT so the strip never comes up short.
  const rankBy = (
    pick: (c: (typeof candidates)[number]) => number
  ): MarketMover[] => {
    const scored = candidates
      .map((c) => ({
        ticker: c.ticker,
        changePercent: pick(c),
        numPortfolios: c.numPortfolios,
        holders: c.holders,
        isEtf: c.isEtf,
      }))
      .sort(
        (a, b) =>
          b.numPortfolios * Math.abs(b.changePercent) -
          a.numPortfolios * Math.abs(a.changePercent)
      );

    const qualified = scored.filter(
      (c) =>
        Math.abs(c.changePercent) >=
        (c.isEtf ? MOVER_ETF_MIN_ABS_CHANGE_PCT : MOVER_STOCK_MIN_ABS_CHANGE_PCT)
    );

    const result = [...qualified];
    if (result.length < MOVER_MIN_COUNT) {
      const chosen = new Set(qualified.map((c) => c.ticker));
      for (const c of scored) {
        if (result.length >= MOVER_MIN_COUNT) break;
        if (!chosen.has(c.ticker)) result.push(c);
      }
    }

    return result.map(({ ticker, changePercent, holders }) => ({
      ticker,
      changePercent,
      holders,
    }));
  };

  return {
    regular: rankBy((c) => c.changeRegular),
    extended: rankBy((c) => c.changeExtended),
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

  const ADMIN_HASH = '$2b$10$PHYCpLb5/4zFCetogpu3G.U3oNv6M6z7hHoL/wzaWVxSk.kq8Uucm';

  try {
    // Handle analytics action (admin-only)
    if (req.method === 'GET' && req.query.action === 'analytics') {
      const token = req.query.token as string;
      const password = req.query.password as string;

      if (!token && !password) {
        res.status(401).json({ error: 'Admin password required' });
        return;
      }

      // Try token auth first (any portfolio ID works — just checking isAdmin)
      let isAdmin = false;
      if (token) {
        const session = await verifySessionToken(token);
        isAdmin = session?.isAdmin ?? false;
      }
      if (!isAdmin && password) {
        isAdmin = await bcrypt.compare(password, ADMIN_HASH);
      }

      if (!isAdmin) {
        res.status(401).json({ error: 'Invalid admin password' });
        return;
      }

      const days = parseInt(req.query.days as string) || 30;
      const excludeViewersParam = (req.query.excludeViewers as string) || '';
      const excludeViewerIds = excludeViewersParam
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const data = await getAnalyticsData(days, { excludeViewerIds });
      res.status(200).json(data);
      return;
    }

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

      // Build response with visibility checks.
      // Three cases per row:
      //   hideAllValues    — restricted viewer + allocation_public=FALSE → null everything (today's blur).
      //   hideDollarsOnly  — restricted viewer + allocation_public=TRUE  → null dollars, keep %-changes
      //                                                                   so the LP can show "+X.XX% today".
      //   full             — owner / allowed viewer → unchanged.
      const portfoliosWithSummary = await Promise.all(
        portfolios.map(async (portfolio) => {
          const isOwner = loggedInAs?.toLowerCase() === portfolio.id.toLowerCase();
          const isAllowed = loggedInAs ? await isAllowedViewer(portfolio.id, loggedInAs) : false;
          const restricted =
            (portfolio.visibility === 'private' && !isOwner) ||
            (portfolio.visibility === 'selective' && !isOwner && !isAllowed);
          // `?? true` tolerates Redis blobs cached before migration 010.
          const allocationPublic = portfolio.allocation_public ?? true;
          const hideAllValues = restricted && !allocationPublic;
          const hideDollarsOnly = restricted && allocationPublic;

          const snapshot = snapshotMap.get(portfolio.id);

          // Compute regular-hours totals from holdings' regularMarketPrice and
          // peak-potential (what-if-all-hit-52w-high) in a single pass. Shared
          // between full-access and hideDollarsOnly branches.
          let regularTotalValue = 0;
          let regularPreviousTotal = 0;
          let peakPotentialValue = 0;
          if (snapshot) {
            for (const h of snapshot.holdings_json) {
              if (h.isStatic) {
                regularTotalValue += h.value;
                regularPreviousTotal += h.value;
                peakPotentialValue += h.value;
              } else {
                regularTotalValue += h.shares * h.regularMarketPrice;
                regularPreviousTotal += h.shares * h.previousClose;
                peakPotentialValue += (h.week52High != null && h.week52High > 0)
                  ? h.shares * h.week52High
                  : h.value;
              }
            }
          }
          const regularDayChange = regularTotalValue - regularPreviousTotal;
          const regularDayChangePercent = regularPreviousTotal > 0
            ? (regularDayChange / regularPreviousTotal) * 100
            : 0;

          // 30D figures, anchored on the first datapoint of history_30d_json
          // (the oldest day we have stored, ~30 trading days back). Null
          // anchor → null change/% so the FE can render "—" instead of
          // pretending zero. Two flavors mirror 1D: extended-hours-aware and
          // regular-session-only.
          const thirtyDayAnchor = snapshot?.history_30d_json?.[0]?.value ?? null;
          const thirtyDayWindowStart = snapshot?.history_30d_json?.[0]?.date ?? null;
          const hasThirtyDayAnchor = snapshot != null && thirtyDayAnchor != null && thirtyDayAnchor > 0;
          const thirtyDayChange = hasThirtyDayAnchor
            ? snapshot!.total_value - thirtyDayAnchor!
            : null;
          const thirtyDayChangePercent = hasThirtyDayAnchor
            ? ((snapshot!.total_value - thirtyDayAnchor!) / thirtyDayAnchor!) * 100
            : null;
          const regularThirtyDayChange = hasThirtyDayAnchor
            ? regularTotalValue - thirtyDayAnchor!
            : null;
          const regularThirtyDayChangePercent = hasThirtyDayAnchor
            ? ((regularTotalValue - thirtyDayAnchor!) / thirtyDayAnchor!) * 100
            : null;

          if (hideAllValues) {
            return {
              ...portfolio,
              totalValue: null,
              dayChange: null,
              dayChangePercent: null,
              regularTotalValue: null,
              regularDayChange: null,
              regularDayChangePercent: null,
              peakPotentialValue: null,
              thirtyDayChange: null,
              thirtyDayChangePercent: null,
              regularThirtyDayChange: null,
              regularThirtyDayChangePercent: null,
              thirtyDayWindowStart: null,
            };
          }

          if (hideDollarsOnly) {
            // Null the dollar-denominated fields but expose day-change
            // percentages so the LP row can show "+X.XX% today" instead of a
            // blur. The FE detects this branch via (visibility !== 'public'
            // && totalValue === null && allocation_public).
            return {
              ...portfolio,
              totalValue: null,
              dayChange: null,
              dayChangePercent: snapshot?.day_change_percent ?? 0,
              regularTotalValue: null,
              regularDayChange: null,
              regularDayChangePercent: snapshot ? regularDayChangePercent : 0,
              peakPotentialValue: null,
              thirtyDayChange: null,
              thirtyDayChangePercent,
              regularThirtyDayChange: null,
              regularThirtyDayChangePercent,
              thirtyDayWindowStart,
              lastUpdated: snapshot?.updated_at,
            };
          }

          if (snapshot) {
            return {
              ...portfolio,
              totalValue: snapshot.total_value,
              dayChange: snapshot.day_change,
              dayChangePercent: snapshot.day_change_percent,
              regularTotalValue,
              regularDayChange,
              regularDayChangePercent,
              peakPotentialValue,
              thirtyDayChange,
              thirtyDayChangePercent,
              regularThirtyDayChange,
              regularThirtyDayChangePercent,
              thirtyDayWindowStart,
              lastUpdated: snapshot.updated_at,
            };
          }

          // No snapshot yet
          return {
            ...portfolio,
            totalValue: 0,
            dayChange: 0,
            dayChangePercent: 0,
            regularTotalValue: 0,
            regularDayChange: 0,
            regularDayChangePercent: 0,
            peakPotentialValue: 0,
            thirtyDayChange: null,
            thirtyDayChangePercent: null,
            regularThirtyDayChange: null,
            regularThirtyDayChangePercent: null,
            thirtyDayWindowStart: null,
          };
        })
      );

      console.log(`[TIMING] portfolios.ts GET total: ${Date.now() - requestStart}ms`);
      res.status(200).json({
        portfolios: portfoliosWithSummary,
        count,
        maxPortfolios: MAX_PORTFOLIOS,
        canCreate: count < MAX_PORTFOLIOS,
        movers: computeMarketMovers(portfolios, snapshotMap),
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

      // Validate against DB constraints before any write.
      classification.errors.push(...validateClassifiedHoldings(classification));

      if (!hasClassifiedHoldings(classification) && classification.errors.length === 0) {
        res.status(400).json({ error: 'At least one nonzero holding is required' });
        return;
      }

      // If preview mode, return the enhanced preview
      if (isPreview) {
        res.status(200).json(buildPreviewResponse(classification));
        return;
      }

      // Check for validation errors
      if (classification.errors.length > 0) {
        res.status(400).json({ error: 'Some holdings are invalid', details: classification.errors });
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
          name: (holding.name || holding.ticker).slice(0, 100),
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
          name: (holding.name || holding.ticker).slice(0, 100),
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

      // Generate AI hot take (non-blocking)
      try {
        const snapshot = await getPortfolioSnapshot(cleanId);
        if (snapshot && snapshot.holdings_json.length > 0) {
          const holdings: HoldingSummary[] = snapshot.holdings_json.map((h) => ({
            ticker: h.ticker,
            name: h.name,
            value: h.value,
            allocation: h.allocation,
            instrumentType: h.instrumentType,
          }));
          const hotTake = await generateHotTake(holdings, snapshot.total_value);
          await updateHotTake(cleanId, hotTake);
        }
      } catch (err) {
        console.error(`Failed to generate hot take for ${cleanId}:`, err);
        // Non-blocking - don't fail the request
      }

      res.status(201).json({
        id: cleanId,
        message: 'Portfolio created successfully',
      });
      return;
    }

    if (req.method === 'PUT') {
      // Update existing portfolio (or preview classification)
      const { id, password, token, holdings: holdingsInput, visibility, viewers, newPassword } = req.body;
      const isPreview = req.query.preview === 'true';

      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Portfolio ID is required' });
        return;
      }

      // Verify authentication (token or password)
      const { authenticated } = await authenticateRequest(id, token, password);
      if (!authenticated) {
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

      // Validate against DB constraints before any write.
      classification.errors.push(...validateClassifiedHoldings(classification));

      if (!hasClassifiedHoldings(classification) && classification.errors.length === 0) {
        res.status(400).json({ error: 'At least one nonzero holding is required' });
        return;
      }

      // If preview mode, return the enhanced preview
      if (isPreview) {
        res.status(200).json(buildPreviewResponse(classification));
        return;
      }

      // Check for validation errors
      if (classification.errors.length > 0) {
        res.status(400).json({ error: 'Some holdings are invalid', details: classification.errors });
        return;
      }

      // Build database holdings from classification
      const dbHoldings = [];

      for (const holding of classification.tradeable) {
        dbHoldings.push({
          ticker: holding.ticker,
          name: (holding.name || holding.ticker).slice(0, 100),
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
          name: (holding.name || holding.ticker).slice(0, 100),
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

      // Invalidate all sessions if password was changed
      if (settings.password_hash) {
        await deleteSessionsForPortfolio(id);
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

      // Generate AI hot take and clear chat history (non-blocking)
      try {
        const snapshot = await getPortfolioSnapshot(id);
        if (snapshot && snapshot.holdings_json.length > 0) {
          const holdings: HoldingSummary[] = snapshot.holdings_json.map((h) => ({
            ticker: h.ticker,
            name: h.name,
            value: h.value,
            allocation: h.allocation,
            instrumentType: h.instrumentType,
          }));
          const hotTake = await generateHotTake(holdings, snapshot.total_value);
          await updateHotTake(id, hotTake);
          // Clear chat history since portfolio has changed
          await clearChatHistory(id);
        }
      } catch (err) {
        console.error(`Failed to generate hot take for ${id}:`, err);
        // Non-blocking - don't fail the request
      }

      res.status(200).json({
        id,
        message: 'Portfolio updated successfully',
      });
      return;
    }

    if (req.method === 'DELETE') {
      // Delete portfolio
      const { id, password, token } = req.body;

      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Portfolio ID is required' });
        return;
      }

      // Verify authentication (token or password)
      const { authenticated } = await authenticateRequest(id, token, password);
      if (!authenticated) {
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
    // Translate known Postgres errors into actionable 400s (defense-in-depth;
    // pre-write validation should already catch these).
    const code = (error as { code?: string })?.code;
    if (code === '22001') {
      res.status(400).json({ error: 'A holding name is too long (max 20 characters).' });
      return;
    }
    if (code === '23505' || code === '21000') {
      res.status(400).json({ error: 'Each ticker and static holding name must be unique.' });
      return;
    }
    if (code === '22003') {
      res.status(400).json({ error: 'A shares or value figure is out of range.' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}
