import { Redis } from '@upstash/redis';
import type { DbPortfolioSnapshot, DbPortfolio, DbPriceCache, Visibility } from './db.js';

// Initialize Redis client
// Note: env var names have extra prefix from Vercel integration
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN!,
});

// Key prefixes
const SNAPSHOT_PREFIX = 'snapshot:';
const ALL_SNAPSHOTS_KEY = 'all_snapshots';
const PORTFOLIO_PREFIX = 'portfolio:';
const PORTFOLIOS_LIST_KEY = 'portfolios_list';
const PORTFOLIO_COUNT_KEY = 'portfolio_count';
const PRICE_PREFIX = 'price:';

// Portfolio metadata type (without password_hash for security)
export interface CachedPortfolio {
  id: string;
  display_name: string | null;
  created_at: string;
  is_private: boolean;
  visibility: Visibility;
}

/**
 * Get a single portfolio snapshot from Redis
 */
export async function getSnapshotFromRedis(portfolioId: string): Promise<DbPortfolioSnapshot | null> {
  try {
    const snapshot = await redis.get<DbPortfolioSnapshot>(`${SNAPSHOT_PREFIX}${portfolioId.toLowerCase()}`);
    return snapshot;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

/**
 * Save a portfolio snapshot to Redis
 */
export async function setSnapshotInRedis(portfolioId: string, snapshot: DbPortfolioSnapshot): Promise<void> {
  try {
    const key = `${SNAPSHOT_PREFIX}${portfolioId.toLowerCase()}`;
    // Store individual snapshot
    await redis.set(key, snapshot);

    // Also update the all_snapshots set with this portfolio ID
    await redis.sadd(ALL_SNAPSHOTS_KEY, portfolioId.toLowerCase());
  } catch (error) {
    console.error('Redis set error:', error);
    // Don't throw - Redis is a cache, failure shouldn't break the app
  }
}

/**
 * Get all portfolio snapshots from Redis
 */
export async function getAllSnapshotsFromRedis(): Promise<DbPortfolioSnapshot[]> {
  try {
    // Get all portfolio IDs from the set
    const portfolioIds = await redis.smembers(ALL_SNAPSHOTS_KEY);

    if (!portfolioIds || portfolioIds.length === 0) {
      return [];
    }

    // Fetch all snapshots in parallel using mget
    const keys = portfolioIds.map(id => `${SNAPSHOT_PREFIX}${id}`);
    const snapshots = await redis.mget<DbPortfolioSnapshot[]>(...keys);

    // Filter out nulls
    return snapshots.filter((s): s is DbPortfolioSnapshot => s !== null);
  } catch (error) {
    console.error('Redis getAllSnapshots error:', error);
    return [];
  }
}

/**
 * Delete a portfolio snapshot from Redis
 */
export async function deleteSnapshotFromRedis(portfolioId: string): Promise<void> {
  try {
    const key = `${SNAPSHOT_PREFIX}${portfolioId.toLowerCase()}`;
    await redis.del(key);
    await redis.srem(ALL_SNAPSHOTS_KEY, portfolioId.toLowerCase());
  } catch (error) {
    console.error('Redis delete error:', error);
  }
}

// ============================================
// Portfolio metadata caching
// ============================================

/**
 * Get a single portfolio from Redis (without password_hash)
 */
export async function getPortfolioFromRedis(portfolioId: string): Promise<CachedPortfolio | null> {
  try {
    const portfolio = await redis.get<CachedPortfolio>(`${PORTFOLIO_PREFIX}${portfolioId.toLowerCase()}`);
    return portfolio;
  } catch (error) {
    console.error('Redis getPortfolio error:', error);
    return null;
  }
}

/**
 * Save a portfolio to Redis (without password_hash)
 */
export async function setPortfolioInRedis(portfolio: DbPortfolio): Promise<void> {
  try {
    const cached: CachedPortfolio = {
      id: portfolio.id,
      display_name: portfolio.display_name,
      created_at: portfolio.created_at,
      is_private: portfolio.is_private,
      visibility: portfolio.visibility,
    };
    await redis.set(`${PORTFOLIO_PREFIX}${portfolio.id.toLowerCase()}`, cached);
  } catch (error) {
    console.error('Redis setPortfolio error:', error);
  }
}

/**
 * Delete a portfolio from Redis
 */
export async function deletePortfolioFromRedis(portfolioId: string): Promise<void> {
  try {
    await redis.del(`${PORTFOLIO_PREFIX}${portfolioId.toLowerCase()}`);
  } catch (error) {
    console.error('Redis deletePortfolio error:', error);
  }
}

/**
 * Get all portfolios list from Redis
 */
export async function getPortfoliosFromRedis(): Promise<CachedPortfolio[] | null> {
  try {
    const portfolios = await redis.get<CachedPortfolio[]>(PORTFOLIOS_LIST_KEY);
    return portfolios;
  } catch (error) {
    console.error('Redis getPortfolios error:', error);
    return null;
  }
}

/**
 * Save all portfolios list to Redis
 */
export async function setPortfoliosInRedis(portfolios: Omit<DbPortfolio, 'password_hash'>[]): Promise<void> {
  try {
    const cached: CachedPortfolio[] = portfolios.map(p => ({
      id: p.id,
      display_name: p.display_name,
      created_at: p.created_at,
      is_private: p.is_private,
      visibility: p.visibility,
    }));
    await redis.set(PORTFOLIOS_LIST_KEY, cached);
  } catch (error) {
    console.error('Redis setPortfolios error:', error);
  }
}

/**
 * Invalidate portfolios list cache
 */
export async function invalidatePortfoliosListCache(): Promise<void> {
  try {
    await redis.del(PORTFOLIOS_LIST_KEY);
  } catch (error) {
    console.error('Redis invalidatePortfoliosList error:', error);
  }
}

// ============================================
// Portfolio count caching
// ============================================

/**
 * Get portfolio count from Redis
 */
export async function getPortfolioCountFromRedis(): Promise<number | null> {
  try {
    const count = await redis.get<number>(PORTFOLIO_COUNT_KEY);
    return count;
  } catch (error) {
    console.error('Redis getPortfolioCount error:', error);
    return null;
  }
}

/**
 * Save portfolio count to Redis
 */
export async function setPortfolioCountInRedis(count: number): Promise<void> {
  try {
    await redis.set(PORTFOLIO_COUNT_KEY, count);
  } catch (error) {
    console.error('Redis setPortfolioCount error:', error);
  }
}

/**
 * Increment portfolio count in Redis
 */
export async function incrementPortfolioCount(): Promise<void> {
  try {
    await redis.incr(PORTFOLIO_COUNT_KEY);
  } catch (error) {
    console.error('Redis incrementPortfolioCount error:', error);
  }
}

/**
 * Decrement portfolio count in Redis
 */
export async function decrementPortfolioCount(): Promise<void> {
  try {
    await redis.decr(PORTFOLIO_COUNT_KEY);
  } catch (error) {
    console.error('Redis decrementPortfolioCount error:', error);
  }
}

// ============================================
// Price cache
// ============================================

/**
 * Get prices from Redis
 */
export async function getPricesFromRedis(tickers: string[]): Promise<Map<string, DbPriceCache>> {
  const result = new Map<string, DbPriceCache>();
  if (tickers.length === 0) return result;

  try {
    const keys = tickers.map(t => `${PRICE_PREFIX}${t}`);
    const prices = await redis.mget<(DbPriceCache | null)[]>(...keys);

    for (let i = 0; i < tickers.length; i++) {
      if (prices[i]) {
        result.set(tickers[i], prices[i]!);
      }
    }
  } catch (error) {
    console.error('Redis getPrices error:', error);
  }
  return result;
}

/**
 * Save prices to Redis
 */
export async function setPricesInRedis(prices: DbPriceCache[]): Promise<void> {
  if (prices.length === 0) return;

  try {
    const pipeline = redis.pipeline();
    for (const price of prices) {
      pipeline.set(`${PRICE_PREFIX}${price.ticker}`, price);
    }
    await pipeline.exec();
  } catch (error) {
    console.error('Redis setPrices error:', error);
  }
}
