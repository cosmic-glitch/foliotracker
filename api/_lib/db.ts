import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_PORTFOLIOS = 10;
const SALT_ROUNDS = 10;
const ADMIN_HASH = '$2b$10$PHYCpLb5/4zFCetogpu3G.U3oNv6M6z7hHoL/wzaWVxSk.kq8Uucm';

export type Visibility = 'public' | 'private' | 'selective';

export interface DbPortfolio {
  id: string;
  display_name: string | null;
  password_hash: string;
  created_at: string;
  is_private: boolean;
  visibility: Visibility;
  allocation_public: boolean;
  hot_take: string | null;
  hot_take_at: string | null;
  buffett_comment: string | null;
  buffett_comment_at: string | null;
  munger_comment: string | null;
  munger_comment_at: string | null;
  deep_research: string | null;
  deep_research_at: string | null;
}

export interface DbPortfolioChat {
  id: string;
  portfolio_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DbPortfolioViewer {
  portfolio_id: string;
  viewer_id: string;
  created_at: string;
}

export interface DbHolding {
  portfolio_id: string;
  ticker: string;
  name: string;
  shares: number;
  is_static: boolean;
  static_value: number | null;
  instrument_type: string | null;
  cost_basis: number | null;
}

export interface DbDailyPrice {
  ticker: string;
  date: string;
  close_price: number;
}

// Geolocation types and functions
export interface GeoLocation {
  country: string;
  city: string;
  region: string;
}

export async function getGeoFromIP(ip: string): Promise<GeoLocation | null> {
  if (ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'fail') return null;

    return {
      country: data.country || '',
      city: data.city || '',
      region: data.regionName || '',
    };
  } catch (error) {
    console.error('Geo lookup failed:', error);
    return null;
  }
}

// Portfolio list item (excludes password and hot take for list view)
export interface DbPortfolioListItem {
  id: string;
  display_name: string | null;
  created_at: string;
  is_private: boolean;
  visibility: Visibility;
  allocation_public: boolean;
}

// Portfolio functions
export async function getPortfolios(): Promise<DbPortfolioListItem[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, display_name, created_at, is_private, visibility, allocation_public')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getPortfolio(id: string): Promise<DbPortfolio | null> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('id', id.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getPortfolioCount(): Promise<number> {
  const { count, error } = await supabase
    .from('portfolios')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}

export async function createPortfolio(
  id: string,
  password: string,
  displayName?: string,
  visibility: Visibility = 'public'
): Promise<void> {
  const count = await getPortfolioCount();
  if (count >= MAX_PORTFOLIOS) {
    throw new Error('Maximum number of portfolios reached');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const { error } = await supabase.from('portfolios').insert({
    id,
    display_name: displayName || null,
    password_hash: passwordHash,
    is_private: visibility === 'private',
    visibility,
  });

  if (error) throw error;
}

export async function verifyPortfolioPassword(
  id: string,
  password: string
): Promise<boolean> {
  // Check admin password first
  if (await bcrypt.compare(password, ADMIN_HASH)) {
    return true;
  }

  const portfolio = await getPortfolio(id);
  if (!portfolio) return false;

  return bcrypt.compare(password, portfolio.password_hash);
}

// Session token functions
export interface SessionData {
  portfolioId: string;
  isAdmin: boolean;
}

export async function createSession(
  portfolioId: string,
  isAdmin: boolean
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const { error } = await supabase.from('sessions').insert({
    token,
    portfolio_id: portfolioId.toLowerCase(),
    is_admin: isAdmin,
    expires_at: expiresAt,
  });

  if (error) throw error;
  return { token, expiresAt };
}

export async function verifySessionToken(token: string): Promise<SessionData | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('portfolio_id, is_admin, expires_at')
    .eq('token', token)
    .single();

  if (error || !data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) {
    // Clean up expired token
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }

  return { portfolioId: data.portfolio_id, isAdmin: data.is_admin };
}

export async function deleteSessionsForPortfolio(portfolioId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('portfolio_id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function authenticateRequest(
  portfolioId: string,
  token?: string | null,
  password?: string | null
): Promise<{ authenticated: boolean; isAdmin: boolean }> {
  // Try token first (fast path)
  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      // Token is valid if it's for this portfolio OR it's an admin session
      if (session.portfolioId === portfolioId.toLowerCase() || session.isAdmin) {
        return { authenticated: true, isAdmin: session.isAdmin };
      }
    }
  }

  // Fall back to password (slow path — bcrypt)
  if (password) {
    const isValid = await verifyPortfolioPassword(portfolioId, password);
    return { authenticated: isValid, isAdmin: false };
  }

  return { authenticated: false, isAdmin: false };
}

export async function deleteExpiredSessions(): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .lt('expires_at', new Date().toISOString());

  if (error) {
    console.error('Failed to clean up expired sessions:', error);
  }
}

// Share link types and functions
export type ShareLinkMode = 'full' | 'allocation_only';

export interface DbShareLink {
  id: string;
  portfolio_id: string;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  mode: ShareLinkMode;
}

export async function createShareLink(
  portfolioId: string,
  durationDays: number,
  label: string | null,
  mode: ShareLinkMode = 'full'
): Promise<DbShareLink> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('share_links')
    .insert({
      portfolio_id: portfolioId.toLowerCase(),
      token,
      label,
      expires_at: expiresAt,
      mode,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as DbShareLink;
}

export async function listShareLinks(portfolioId: string): Promise<DbShareLink[]> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as DbShareLink[];
}

export async function getShareLinkByToken(token: string): Promise<DbShareLink | null> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .eq('token', token)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return (data as DbShareLink) || null;
}

export async function revokeShareLink(id: string, portfolioId: string): Promise<boolean> {
  // Scoped to portfolioId to prevent cross-portfolio revocation by a leaked id.
  const { data, error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('portfolio_id', portfolioId.toLowerCase())
    .is('revoked_at', null)
    .select('id');

  if (error) throw error;
  return !!data && data.length > 0;
}

export function isShareLinkValid(link: DbShareLink): boolean {
  if (link.revoked_at) return false;
  if (new Date(link.expires_at) <= new Date()) return false;
  return true;
}

export async function deletePortfolio(id: string): Promise<void> {
  const normalizedId = id.toLowerCase();

  // Delete holdings first (foreign key constraint)
  const { error: holdingsError } = await supabase
    .from('holdings')
    .delete()
    .eq('portfolio_id', normalizedId);

  if (holdingsError) throw holdingsError;

  // Delete the portfolio
  const { error } = await supabase
    .from('portfolios')
    .delete()
    .eq('id', normalizedId);

  if (error) throw error;
}

export async function updatePortfolioSettings(
  id: string,
  settings: {
    is_private?: boolean;
    display_name?: string;
    password_hash?: string;
    visibility?: Visibility;
    allocation_public?: boolean;
  }
): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update(settings)
    .eq('id', id.toLowerCase());

  if (error) throw error;
}

// Holdings functions
export async function getHoldings(portfolioId: string): Promise<DbHolding[]> {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .order('shares', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function setHoldings(
  portfolioId: string,
  holdings: Omit<DbHolding, 'portfolio_id'>[]
): Promise<void> {
  const normalizedId = portfolioId.toLowerCase();
  const rows = holdings.map((h) => ({ ...h, portfolio_id: normalizedId }));

  // No holdings to keep: remove everything for this portfolio.
  if (rows.length === 0) {
    const { error } = await supabase
      .from('holdings')
      .delete()
      .eq('portfolio_id', normalizedId);
    if (error) throw error;
    return;
  }

  // 1. Upsert the new/changed rows FIRST (single atomic statement). If this
  //    throws, nothing has been deleted — existing holdings stay intact, so a
  //    failed write can never wipe a portfolio.
  const { error: upsertError } = await supabase
    .from('holdings')
    .upsert(rows, { onConflict: 'portfolio_id,ticker' });
  if (upsertError) throw upsertError;

  // 2. Remove rows for tickers no longer present. Worst case if this fails:
  //    a few stale rows linger until the next save — never lost data.
  const { data: existing, error: selectError } = await supabase
    .from('holdings')
    .select('ticker')
    .eq('portfolio_id', normalizedId);
  if (selectError) throw selectError;

  const kept = new Set(rows.map((r) => r.ticker));
  const stale = (existing ?? []).map((e) => e.ticker).filter((t) => !kept.has(t));
  if (stale.length > 0) {
    const { error: deleteError } = await supabase
      .from('holdings')
      .delete()
      .eq('portfolio_id', normalizedId)
      .in('ticker', stale);
    if (deleteError) throw deleteError;
  }
}

export async function getDailyPrices(
  tickers: string[],
  days: number = 30
): Promise<DbDailyPrice[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  // Paginate explicitly. PostgREST caps a single response at the project's
  // "Max rows" limit (1000 by default), so an unpaginated select silently
  // truncates once tickers * days exceeds that. The snapshot refresh relies on
  // this result to decide which tickers have stale history — a truncated
  // result makes every ticker look stale and triggers a full Yahoo re-fetch +
  // daily_prices re-upsert on every run. Secondary sort on ticker keeps the
  // ordering total so rows can't shift across page boundaries.
  const PAGE_SIZE = 1000;
  const rows: DbDailyPrice[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('daily_prices')
      .select('*')
      .in('ticker', tickers)
      .gte('date', startDateStr)
      .order('date', { ascending: true })
      .order('ticker', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function upsertDailyPrice(
  ticker: string,
  date: string,
  closePrice: number
): Promise<void> {
  const { error } = await supabase.from('daily_prices').upsert(
    {
      ticker,
      date,
      close_price: closePrice,
    },
    { onConflict: 'ticker,date' }
  );

  if (error) throw error;
}

// Portfolio viewers functions (for selective visibility)
export async function getPortfolioViewers(portfolioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolio_viewers')
    .select('viewer_id')
    .eq('portfolio_id', portfolioId.toLowerCase());

  if (error) throw error;
  return (data || []).map((row) => row.viewer_id);
}

export async function setPortfolioViewers(
  portfolioId: string,
  viewerIds: string[]
): Promise<void> {
  const normalizedId = portfolioId.toLowerCase();

  // Delete existing viewers
  const { error: deleteError } = await supabase
    .from('portfolio_viewers')
    .delete()
    .eq('portfolio_id', normalizedId);

  if (deleteError) throw deleteError;

  // Insert new viewers
  if (viewerIds.length > 0) {
    const { error: insertError } = await supabase.from('portfolio_viewers').insert(
      viewerIds.map((viewerId) => ({
        portfolio_id: normalizedId,
        viewer_id: viewerId.toLowerCase(),
      }))
    );

    if (insertError) throw insertError;
  }
}

export async function isAllowedViewer(
  portfolioId: string,
  viewerId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('portfolio_viewers')
    .select('viewer_id')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .eq('viewer_id', viewerId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

// Price cache types and functions
export interface DbPriceCache {
  ticker: string;
  current_price: number;
  previous_close: number;
  change_percent: number;
  updated_at: string;
}

export async function getCachedPrices(tickers: string[]): Promise<Map<string, DbPriceCache>> {
  if (tickers.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('price_cache')
    .select('*')
    .in('ticker', tickers);

  if (error) throw error;

  const result = new Map<string, DbPriceCache>();
  for (const row of data || []) {
    result.set(row.ticker, row);
  }
  return result;
}

export async function upsertPriceCache(
  prices: Array<{
    ticker: string;
    current_price: number;
    previous_close: number;
    change_percent: number;
  }>
): Promise<void> {
  if (prices.length === 0) return;

  const { error } = await supabase.from('price_cache').upsert(
    prices.map((p) => ({
      ticker: p.ticker,
      current_price: p.current_price,
      previous_close: p.previous_close,
      change_percent: p.change_percent,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'ticker' }
  );

  if (error) throw error;
}

// Fundamentals cache types and functions
export interface DbFundamentalsCache {
  ticker: string;
  revenue: number | null;
  earnings: number | null;
  forward_eps: number | null;
  week_52_high: number | null;
  operating_margin: number | null;
  revenue_growth_3y: number | null;
  eps_growth_3y: number | null;
  updated_at: string;
}

export async function getCachedFundamentals(tickers: string[]): Promise<Map<string, DbFundamentalsCache>> {
  if (tickers.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('fundamentals_cache')
    .select('*')
    .in('ticker', tickers);

  if (error) throw error;

  const result = new Map<string, DbFundamentalsCache>();
  for (const row of data || []) {
    result.set(row.ticker, row);
  }
  return result;
}

export async function upsertFundamentalsCache(
  fundamentals: Array<{
    ticker: string;
    revenue: number | null;
    earnings: number | null;
    forward_eps: number | null;
    week_52_high: number | null;
    operating_margin: number | null;
    revenue_growth_3y: number | null;
    eps_growth_3y: number | null;
  }>
): Promise<void> {
  if (fundamentals.length === 0) return;

  const { error } = await supabase.from('fundamentals_cache').upsert(
    fundamentals.map((f) => ({
      ...f,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'ticker' }
  );

  if (error) throw error;
}

// Ticker news summary types and functions
export interface TickerNewsSource {
  title: string;
  url: string;
}

export interface DbTickerNewsSummary {
  ticker: string;
  summary_date: string;
  summary_markdown: string;
  sources_json: TickerNewsSource[];
  model: string;
  generated_at: string;
}

// The generator emits this exact line when no material news was found.
const NO_MATERIAL_NEWS_SENTINEL = 'No material news in the last 7 days.';
// When the newest summary is a sentinel, fall back to the most recent real
// summary only if it is no older than this — beyond that the news is stale.
const FALLBACK_MAX_AGE_DAYS = 4;

const isSentinelSummary = (md: string): boolean => {
  const t = md.trim();
  return t.length === 0 || t === NO_MATERIAL_NEWS_SENTINEL;
};

export async function getLatestTickerNewsSummaries(
  tickers: string[]
): Promise<Map<string, DbTickerNewsSummary>> {
  const result = new Map<string, DbTickerNewsSummary>();
  if (tickers.length === 0) return result;

  // Fetch recent rows (last 7 days) for these tickers; pick the best per ticker in JS.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const sinceDate = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('ticker_news_summaries')
    .select('*')
    .in('ticker', tickers)
    .gte('summary_date', sinceDate)
    .order('summary_date', { ascending: false });

  if (error) throw error;

  // Group rows per ticker, preserving the summary_date-desc order.
  const byTicker = new Map<string, DbTickerNewsSummary[]>();
  for (const row of (data || []) as DbTickerNewsSummary[]) {
    const rows = byTicker.get(row.ticker);
    if (rows) rows.push(row);
    else byTicker.set(row.ticker, [row]);
  }

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const [ticker, rows] of byTicker) {
    const newest = rows[0];
    if (!isSentinelSummary(newest.summary_markdown)) {
      result.set(ticker, newest);
      continue;
    }
    // Newest summary is a sentinel — fall back to the most recent real
    // summary, but only if it is still fresh enough to be worth showing.
    const realRow = rows.find((r) => !isSentinelSummary(r.summary_markdown));
    if (realRow) {
      const ageDays = (now - new Date(realRow.summary_date).getTime()) / DAY_MS;
      if (ageDays <= FALLBACK_MAX_AGE_DAYS) {
        result.set(ticker, realRow);
        continue;
      }
    }
    // No fresh real summary — keep the sentinel so the frontend hides it.
    result.set(ticker, newest);
  }
  return result;
}

export async function upsertTickerNewsSummary(summary: {
  ticker: string;
  summary_date: string;
  summary_markdown: string;
  sources_json: TickerNewsSource[];
  model?: string;
}): Promise<void> {
  const { error } = await supabase.from('ticker_news_summaries').upsert(
    {
      ticker: summary.ticker.toUpperCase(),
      summary_date: summary.summary_date,
      summary_markdown: summary.summary_markdown,
      sources_json: summary.sources_json,
      model: summary.model ?? 'claude-code',
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'ticker,summary_date' }
  );

  if (error) throw error;
}

// Portfolio snapshot types and functions
export interface SnapshotHolding {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  previousClose: number;
  value: number;
  allocation: number;
  dayChange: number;
  dayChangePercent: number;
  // Per-holding 30D change drives HoldingsTable's Chg % / Chg $ columns when
  // the global timeframe is set to 30d. Anchor = oldest close in the
  // ticker's 30D historical series (same source as the portfolio's 30D
  // chart). Static holdings: 0/0/null — their value doesn't move and there's
  // no per-share anchor.
  // Optional: snapshots written before this field was introduced lack it.
  // Frontend treats absent as null/0 gracefully.
  thirtyDayChange?: number | null;
  thirtyDayChangePercent?: number | null;
  thirtyDayAnchorPrice?: number | null;
  isStatic: boolean;
  instrumentType: string;
  costBasis: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
  revenue: number | null;
  earnings: number | null;
  forwardPE: number | null;
  pctTo52WeekHigh: number | null;
  week52High: number | null;
  operatingMargin: number | null;
  revenueGrowth3Y: number | null;
  epsGrowth3Y: number | null;
  regularMarketPrice: number;
  // JSONB-stored; the index signature lets future fields land in
  // holdings_json without a type change, and keeps SnapshotHolding[]
  // assignable to api/portfolio.ts's Holding[] (which has the same
  // signature for the same reason).
  [k: string]: unknown;
}

export interface HistoryDataPoint {
  date: string;
  value: number;
}

export interface BenchmarkDataPoint {
  date: string;
  percentChange: number;
}

export interface DbPortfolioSnapshot {
  portfolio_id: string;
  total_value: number;
  day_change: number;
  day_change_percent: number;
  total_gain: number | null;
  total_gain_percent: number | null;
  holdings_json: SnapshotHolding[];
  history_30d_json: HistoryDataPoint[] | null;
  history_1d_json: HistoryDataPoint[] | null;
  regular_history_1d_json: HistoryDataPoint[] | null;
  benchmark_30d_json: BenchmarkDataPoint[] | null;
  market_status: string;
  updated_at: string;
  last_error: string | null;
  last_error_at: string | null;
  stale_tickers: string[];
}

export async function getPortfolioSnapshot(portfolioId: string): Promise<DbPortfolioSnapshot | null> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getAllPortfolioSnapshots(): Promise<DbPortfolioSnapshot[]> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*');

  if (error) throw error;
  return data || [];
}

export async function upsertPortfolioSnapshot(
  snapshot: Omit<DbPortfolioSnapshot, 'updated_at'>
): Promise<void> {
  const { error } = await supabase.from('portfolio_snapshots').upsert(
    {
      ...snapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'portfolio_id' }
  );

  if (error) throw error;
}

export async function deletePortfolioSnapshot(portfolioId: string): Promise<void> {
  const { error } = await supabase
    .from('portfolio_snapshots')
    .delete()
    .eq('portfolio_id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function recordSnapshotError(portfolioId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert(
      {
        portfolio_id: portfolioId.toLowerCase(),
        last_error: errorMessage,
        last_error_at: new Date().toISOString(),
        // Keep existing data if snapshot exists, or set placeholder values if new
        total_value: 0,
        day_change: 0,
        day_change_percent: 0,
        holdings_json: [],
        market_status: 'unknown',
        stale_tickers: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'portfolio_id', ignoreDuplicates: false }
    );

  if (error) throw error;
}

// Analytics event types and functions
export interface AnalyticsEvent {
  event_type: string;
  portfolio_id?: string;
  viewer_id?: string;
  ip_address?: string;
  country?: string;
  city?: string;
  region?: string;
  user_agent?: string;
  referer?: string;
}

export async function logAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  const { error } = await supabase.from('analytics_events').insert(event);
  if (error) {
    console.error('Failed to log analytics event:', error);
    throw error;
  }
}

export interface AnalyticsAggregation {
  totalViews: number;
  totalLogins: number;
  uniqueVisitors: number;
  todayViews: number;
  todayLogins: number;
  eventsByDay: { date: string; views: number; logins: number }[];
  viewerLocations: ViewerLocationGroup[];
  anonymousLocations: LocationDistributionEntry[];
  viewerActivityByDay: {
    viewer_id: string;
    portfolio_id: string;
    dailyCounts: Record<string, number>; // { "2026-01-27": 3, "2026-01-26": 1, ... }
  }[];
  anonymousActivityByDay: {
    identity: string;       // ip|ua hash key, stable per (ip, user_agent)
    label: string;          // display: "Seattle • iPhone Safari • 172.56.108.x"
    portfolio_id: string;
    dailyCounts: Record<string, number>;
  }[];
  viewerDeviceBreakdown: { viewer_id: string; desktop: number; mobile: number }[];
}

// Single pre-formatted display string per location: "Seattle, WA" for US
// (state abbreviation), "Bangalore, India" for non-US (full country name).
export interface ViewerLocationOccurrence {
  display: string;
  count: number;
  lastSeenAt: string; // ISO timestamp
}

export interface ViewerLocationGroup {
  viewer_id: string;
  locations: ViewerLocationOccurrence[];
}

export interface LocationDistributionEntry {
  display: string;
  uniqueIdentities: number;
  totalViews: number;
}

// Sentinel keys used in analytics aggregations when the underlying column is null.
// Exported so the frontend can recognize them and render friendly labels.
export const ANONYMOUS_VIEWER = '(anonymous)';
export const LANDING_PORTFOLIO = '(landing)';

function extractBrowser(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function maskIp(ip: string | null): string {
  if (!ip || ip === 'unknown') return '?';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  return ip;
}

const US_STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'Puerto Rico': 'PR',
};

const COUNTRY_ISO: Record<string, string> = {
  'United States': 'US', 'United Kingdom': 'GB', Canada: 'CA', Australia: 'AU',
  India: 'IN', Germany: 'DE', France: 'FR', Japan: 'JP', Singapore: 'SG',
  Brazil: 'BR', China: 'CN', Mexico: 'MX', Spain: 'ES', Italy: 'IT',
  Netherlands: 'NL', Sweden: 'SE', Norway: 'NO', Denmark: 'DK', Finland: 'FI',
  Ireland: 'IE', Switzerland: 'CH', Austria: 'AT', Belgium: 'BE', Poland: 'PL',
  Portugal: 'PT', Russia: 'RU', Ukraine: 'UA', Turkey: 'TR', Israel: 'IL',
  'United Arab Emirates': 'AE', 'Saudi Arabia': 'SA', 'South Africa': 'ZA',
  'New Zealand': 'NZ', 'Hong Kong': 'HK', 'South Korea': 'KR', Taiwan: 'TW',
  Thailand: 'TH', Indonesia: 'ID', Philippines: 'PH', Vietnam: 'VN', Malaysia: 'MY',
  Argentina: 'AR', Chile: 'CL', Colombia: 'CO',
};

function formatCityLocation(city: string, region: string | null, country: string | null): string {
  if (country === 'United States') {
    const abbr = region ? US_STATE_ABBR[region] : null;
    return abbr ? `${city}, ${abbr}` : city;
  }
  if (country) {
    const iso = COUNTRY_ISO[country];
    return `${city}, ${iso || country}`;
  }
  return city;
}

// "Seattle, WA" for US (state abbreviation), "Bangalore, India" for non-US
// (full country name). Distinct from formatCityLocation, which uses ISO codes
// for non-US to keep the anonymous activity labels compact.
function formatLocationLong(
  city: string | null,
  region: string | null,
  country: string | null
): string {
  if (!city) return country || 'Unknown';
  if (country === 'United States') {
    const abbr = region ? US_STATE_ABBR[region] : null;
    return abbr ? `${city}, ${abbr}` : city;
  }
  return country ? `${city}, ${country}` : city;
}

function buildAnonLabel(event: { city: string | null; region: string | null; country: string | null; user_agent: string | null; ip_address: string | null }): string {
  const city = event.city
    ? formatCityLocation(event.city, event.region, event.country)
    : 'Unknown location';
  const device = getDeviceType(event.user_agent);
  const browser = extractBrowser(event.user_agent);
  const deviceBrowser = device === 'Desktop' ? `${browser} desktop` : `${device} ${browser}`;
  return `${city} • ${deviceBrowser} • ${maskIp(event.ip_address)}`;
}

function getDeviceType(userAgent: string | null): string {
  if (!userAgent) return 'Unknown';
  const ua = userAgent.toLowerCase();

  // Check for mobile devices
  if (/iphone|ipod/.test(ua)) return 'Mobile';
  if (/android/.test(ua) && /mobile/.test(ua)) return 'Mobile';
  if (/mobile|phone/.test(ua)) return 'Mobile';

  // Check for tablets
  if (/ipad/.test(ua)) return 'Tablet';
  if (/android/.test(ua) && !/mobile/.test(ua)) return 'Tablet';
  if (/tablet/.test(ua)) return 'Tablet';

  // Desktop (default)
  return 'Desktop';
}

// Get Pacific date string (YYYY-MM-DD) from a UTC timestamp
function getPacificDateString(utcTimestamp: string | Date): string {
  const date = typeof utcTimestamp === 'string' ? new Date(utcTimestamp) : utcTimestamp;
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// Get midnight in Seattle/Pacific timezone as a UTC timestamp
function getSeattleMidnightToday(): Date {
  // Get today's date in Pacific timezone (YYYY-MM-DD format)
  const pacificDate = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles'
  });

  // Start with midnight UTC on this date
  const midnightUTC = new Date(`${pacificDate}T00:00:00.000Z`);

  // Determine what hour it is in Pacific timezone at midnight UTC
  const pacificHourAtMidnightUTC = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false
    }).format(midnightUTC)
  );

  // Calculate offset: if 4pm (16) in Seattle at midnight UTC, add 8 hours
  const offsetHours = pacificHourAtMidnightUTC >= 12
    ? 24 - pacificHourAtMidnightUTC
    : -pacificHourAtMidnightUTC;

  return new Date(midnightUTC.getTime() + offsetHours * 60 * 60 * 1000);
}

export async function getAnalyticsData(
  days: number = 30,
  options: { excludeViewerIds?: string[] } = {}
): Promise<AnalyticsAggregation> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  const todayStart = getSeattleMidnightToday();
  const todayStartStr = todayStart.toISOString();

  // Fetch all events in the date range
  const { data: events, error } = await supabase
    .from('analytics_events')
    .select('*')
    .gte('created_at', startDateStr)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Drop events from excluded viewers (e.g. site owner's own test traffic) so
  // every downstream aggregation — totals, by-day, locations, devices — is
  // computed on the same filtered set.
  const excluded = new Set((options.excludeViewerIds || []).map((v) => v.toLowerCase()));
  const allEvents = (events || []).filter(
    (e) => !(e.viewer_id && excluded.has(e.viewer_id.toLowerCase()))
  );

  // Calculate aggregations
  const views = allEvents.filter((e) => e.event_type === 'view');
  const logins = allEvents.filter((e) => e.event_type === 'login');
  const todayViews = views.filter((e) => e.created_at >= todayStartStr);
  const todayLogins = logins.filter((e) => e.created_at >= todayStartStr);
  const uniqueIPs = new Set(allEvents.map((e) => e.ip_address).filter(Boolean));

  // Events by day
  const eventsByDayMap = new Map<string, { views: number; logins: number }>();
  for (const event of allEvents) {
    const date = event.created_at.split('T')[0];
    const existing = eventsByDayMap.get(date) || { views: 0, logins: 0 };
    if (event.event_type === 'view') existing.views++;
    if (event.event_type === 'login') existing.logins++;
    eventsByDayMap.set(date, existing);
  }
  const eventsByDay = Array.from(eventsByDayMap.entries())
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-viewer location history (logged-in viewers) and anonymous location
  // distribution. Both are built off views + logins so login-only sightings
  // still register a location.
  const viewerLocationMap = new Map<
    string,
    Map<string, { city: string | null; region: string | null; country: string | null; count: number; lastSeenAt: string }>
  >();
  type AnonLocAgg = {
    city: string | null;
    region: string | null;
    country: string | null;
    totalViews: number;
    identities: Set<string>;
  };
  const anonLocMap = new Map<string, AnonLocAgg>();

  for (const event of allEvents) {
    if (event.event_type !== 'view' && event.event_type !== 'login') continue;
    const city = event.city || null;
    const region = event.region || null;
    const country = event.country || null;
    const locKey = `${city ?? ''}|${region ?? ''}|${country ?? ''}`;

    if (event.viewer_id) {
      if (!viewerLocationMap.has(event.viewer_id)) {
        viewerLocationMap.set(event.viewer_id, new Map());
      }
      const m = viewerLocationMap.get(event.viewer_id)!;
      const existing = m.get(locKey);
      if (existing) {
        existing.count++;
        if (event.created_at > existing.lastSeenAt) existing.lastSeenAt = event.created_at;
      } else {
        m.set(locKey, { city, region, country, count: 1, lastSeenAt: event.created_at });
      }
    } else {
      let agg = anonLocMap.get(locKey);
      if (!agg) {
        agg = { city, region, country, totalViews: 0, identities: new Set() };
        anonLocMap.set(locKey, agg);
      }
      agg.totalViews++;
      agg.identities.add(`${event.ip_address || ''}|${event.user_agent || ''}`);
    }
  }

  const viewerLocations: ViewerLocationGroup[] = Array.from(viewerLocationMap.entries())
    .map(([viewer_id, locMap]) => {
      const locations = Array.from(locMap.values())
        .map((v) => ({
          display: formatLocationLong(v.city, v.region, v.country),
          count: v.count,
          lastSeenAt: v.lastSeenAt,
        }))
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      return { viewer_id, locations };
    })
    // Most-recently-seen viewers float to the top.
    .sort((a, b) => {
      const aMax = a.locations[0]?.lastSeenAt || '';
      const bMax = b.locations[0]?.lastSeenAt || '';
      return bMax.localeCompare(aMax);
    });

  const anonymousLocations: LocationDistributionEntry[] = Array.from(anonLocMap.values())
    .map((v) => ({
      display: formatLocationLong(v.city, v.region, v.country),
      uniqueIdentities: v.identities.size,
      totalViews: v.totalViews,
    }))
    .sort((a, b) => b.uniqueIdentities - a.uniqueIdentities || b.totalViews - a.totalViews);

  // Viewer activity by day (last 5 days in Pacific timezone)
  // Build list of last 5 days in YYYY-MM-DD format (Pacific)
  const last5Days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last5Days.push(getPacificDateString(d));
  }
  // Get Pacific midnight 5 days ago as cutoff
  const fiveDaysAgoPacific = new Date(getSeattleMidnightToday().getTime() - 5 * 24 * 60 * 60 * 1000);
  const fiveDaysAgoStr = fiveDaysAgoPacific.toISOString();

  // Logged-in viewer activity: keyed by (viewer_id, portfolio_id). Null portfolio_id
  // (landing-page views) becomes its own LANDING_PORTFOLIO bucket.
  const viewerActivityByDayMap = new Map<string, Record<string, number>>();
  // Anonymous viewer activity: keyed by (ip|user_agent, portfolio_id). Each unique
  // (IP, UA) pair counts as a distinct anonymous identity. Carries a representative
  // label derived from the first event we see for that identity.
  const anonActivityMap = new Map<string, Record<string, number>>();
  const anonLabelMap = new Map<string, string>();

  const viewsAndLogins = allEvents.filter((e) => e.event_type === 'view' || e.event_type === 'login');
  for (const event of viewsAndLogins) {
    if (event.created_at < fiveDaysAgoStr) continue;
    const portfolio = event.portfolio_id || LANDING_PORTFOLIO;
    const date = getPacificDateString(event.created_at);

    if (event.viewer_id) {
      const key = `${event.viewer_id}|${portfolio}`;
      if (!viewerActivityByDayMap.has(key)) viewerActivityByDayMap.set(key, {});
      const counts = viewerActivityByDayMap.get(key)!;
      counts[date] = (counts[date] || 0) + 1;
    } else {
      const identity = `${event.ip_address || 'unknown'}|${event.user_agent || 'unknown'}`;
      const key = `${identity}|${portfolio}`;
      if (!anonActivityMap.has(key)) anonActivityMap.set(key, {});
      const counts = anonActivityMap.get(key)!;
      counts[date] = (counts[date] || 0) + 1;
      if (!anonLabelMap.has(identity)) {
        anonLabelMap.set(identity, buildAnonLabel(event));
      }
    }
  }

  const viewerActivityByDay = Array.from(viewerActivityByDayMap.entries())
    .map(([key, dailyCounts]) => {
      const [viewer_id, portfolio_id] = key.split('|');
      return { viewer_id, portfolio_id, dailyCounts };
    })
    .sort((a, b) => a.viewer_id.localeCompare(b.viewer_id) || a.portfolio_id.localeCompare(b.portfolio_id));

  const anonymousActivityByDay = Array.from(anonActivityMap.entries())
    .map(([key, dailyCounts]) => {
      // key format: "<ip>|<ua>|<portfolio_id>" — portfolio is the trailing piece
      const lastPipe = key.lastIndexOf('|');
      const identity = key.slice(0, lastPipe);
      const portfolio_id = key.slice(lastPipe + 1);
      return {
        identity,
        label: anonLabelMap.get(identity) || identity,
        portfolio_id,
        dailyCounts,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.portfolio_id.localeCompare(b.portfolio_id));

  // Per-viewer device breakdown. Null viewer_id is pooled into ANONYMOUS_VIEWER.
  const viewerDeviceMap = new Map<string, { desktop: number; mobile: number }>();
  for (const event of allEvents) {
    const viewer = event.viewer_id || ANONYMOUS_VIEWER;
    const device = getDeviceType(event.user_agent);
    if (!viewerDeviceMap.has(viewer)) {
      viewerDeviceMap.set(viewer, { desktop: 0, mobile: 0 });
    }
    const counts = viewerDeviceMap.get(viewer)!;
    if (device === 'Desktop') {
      counts.desktop++;
    } else if (device === 'Mobile' || device === 'Tablet') {
      counts.mobile++;
    }
  }
  const viewerDeviceBreakdown = Array.from(viewerDeviceMap.entries())
    .map(([viewer_id, counts]) => ({ viewer_id, ...counts }))
    .sort((a, b) => (b.desktop + b.mobile) - (a.desktop + a.mobile));

  return {
    totalViews: views.length,
    totalLogins: logins.length,
    uniqueVisitors: uniqueIPs.size,
    todayViews: todayViews.length,
    todayLogins: todayLogins.length,
    eventsByDay,
    viewerLocations,
    anonymousLocations,
    viewerActivityByDay,
    anonymousActivityByDay,
    viewerDeviceBreakdown,
  };
}

// Portfolio chat functions
export async function getChatHistory(portfolioId: string): Promise<DbPortfolioChat[]> {
  const { data, error } = await supabase
    .from('portfolio_chats')
    .select('*')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function addChatMessage(
  portfolioId: string,
  role: 'system' | 'user' | 'assistant',
  content: string
): Promise<void> {
  const { error } = await supabase.from('portfolio_chats').insert({
    portfolio_id: portfolioId.toLowerCase(),
    role,
    content,
  });

  if (error) throw error;
}

export async function clearChatHistory(portfolioId: string): Promise<void> {
  const { error } = await supabase
    .from('portfolio_chats')
    .delete()
    .eq('portfolio_id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function getTodayChatCount(portfolioId: string): Promise<number> {
  const todayStart = getSeattleMidnightToday();
  const todayStartStr = todayStart.toISOString();

  const { count, error } = await supabase
    .from('portfolio_chats')
    .select('*', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId.toLowerCase())
    .eq('role', 'user')
    .gte('created_at', todayStartStr);

  if (error) throw error;
  return count || 0;
}

export async function updateHotTake(portfolioId: string, hotTake: string): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({
      hot_take: hotTake,
      hot_take_at: new Date().toISOString(),
    })
    .eq('id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function updateBuffettComment(portfolioId: string, comment: string): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({
      buffett_comment: comment,
      buffett_comment_at: new Date().toISOString(),
    })
    .eq('id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function updateMungerComment(portfolioId: string, comment: string): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({
      munger_comment: comment,
      munger_comment_at: new Date().toISOString(),
    })
    .eq('id', portfolioId.toLowerCase());

  if (error) throw error;
}

export interface PortfolioAIComments {
  hot_take: string | null;
  hot_take_at: string | null;
  buffett_comment: string | null;
  buffett_comment_at: string | null;
  munger_comment: string | null;
  munger_comment_at: string | null;
  deep_research: string | null;
  deep_research_at: string | null;
}

export async function getPortfolioAIComments(portfolioId: string): Promise<PortfolioAIComments> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('hot_take, hot_take_at, buffett_comment, buffett_comment_at, munger_comment, munger_comment_at, deep_research, deep_research_at')
    .eq('id', portfolioId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || {
    hot_take: null,
    hot_take_at: null,
    buffett_comment: null,
    buffett_comment_at: null,
    munger_comment: null,
    munger_comment_at: null,
    deep_research: null,
    deep_research_at: null,
  };
}

export async function getPortfolioHotTake(portfolioId: string): Promise<{ hot_take: string | null; hot_take_at: string | null }> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('hot_take, hot_take_at')
    .eq('id', portfolioId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || { hot_take: null, hot_take_at: null };
}

export async function updateDeepResearch(portfolioId: string, research: string): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({
      deep_research: research,
      deep_research_at: new Date().toISOString(),
    })
    .eq('id', portfolioId.toLowerCase());

  if (error) throw error;
}

export async function getAllPortfolioIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((p) => p.id);
}
