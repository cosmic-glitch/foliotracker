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
  deep_research: string | null;
  deep_research_at: string | null;
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

// Upcoming events feed (landing page) — see scripts/migrate-upcoming-events.ts.
// One ranked global list, regenerated wholesale by scripts/generate-events.sh.
export interface UpcomingEventSource {
  title: string;
  url: string;
}

export interface DbUpcomingEvent {
  id: string;
  event_type: 'macro' | 'earnings';
  event_date: string; // YYYY-MM-DD
  event_time: string | null;
  title: string;
  detail: string;
  importance: 'high' | 'medium' | 'low';
  tickers: string[];
  holders: string[] | null; // null for macro events
  holder_count: number;
  source: UpcomingEventSource | null;
  position: number; // generator's ranking = display order
  generated_at?: string;
}

// Future-dated events only (past events drop off on their own), returned in the
// generator's ranked display order so the strip can slice the first N.
export async function getUpcomingEvents(): Promise<DbUpcomingEvent[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('upcoming_events')
    .select('*')
    .gte('event_date', today)
    .order('position', { ascending: true });

  if (error) throw error;
  return (data || []) as DbUpcomingEvent[];
}

// Replace the whole feed atomically-ish: upsert the new set FIRST, then delete
// rows no longer present. Same upsert-then-delete-stale safety as setHoldings —
// a failed write can never leave the feed empty.
export async function replaceUpcomingEvents(
  events: Omit<DbUpcomingEvent, 'generated_at'>[]
): Promise<void> {
  if (events.length === 0) {
    const { error } = await supabase
      .from('upcoming_events')
      .delete()
      .neq('id', ''); // no id is empty, so this matches every row
    if (error) throw error;
    return;
  }

  const generated_at = new Date().toISOString();
  const rows = events.map((e) => ({ ...e, generated_at }));

  const { error: upsertError } = await supabase
    .from('upcoming_events')
    .upsert(rows, { onConflict: 'id' });
  if (upsertError) throw upsertError;

  const { data: existing, error: selectError } = await supabase
    .from('upcoming_events')
    .select('id');
  if (selectError) throw selectError;

  const keep = new Set(events.map((e) => e.id));
  const stale = (existing ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  if (stale.length > 0) {
    const { error: deleteError } = await supabase
      .from('upcoming_events')
      .delete()
      .in('id', stale);
    if (deleteError) throw deleteError;
  }
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
  // The share_links row a view came through, when the visitor opened a
  // /:portfolioId?share=<token> link. Null/undefined for organic, logged-in, or
  // anonymous views not tied to a share link. Powers the Shared Link Access panel.
  share_link_id?: string;
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
    lastVisitAt: string;    // ISO timestamp of the most recent event in the window
    dailyCounts: Record<string, number>; // { "2026-01-27": 3, "2026-01-26": 1, ... }
  }[];
  anonymousActivityByDay: {
    identity: string;       // the visitor's IP, stable per IP (browser/device merged)
    label: string;          // display: "Seattle • 172.56.108.x"
    portfolio_id: string;
    lastVisitAt: string;    // ISO timestamp of the most recent event in the window
    dailyCounts: Record<string, number>;
  }[];
  viewerDeviceBreakdown: { viewer_id: string; desktop: number; mobile: number }[];
  portfolioActivityByDay: {
    portfolio_id: string;
    dailyCounts: Record<string, number>;
  }[];
  shareLinkAccess: ShareLinkAccessGroup[];
}

// Per-share-link access, grouped by the portfolio the links belong to. Stats are
// all-time (not windowed like the rest of the dashboard): share links outlive the
// 30-day window and the owner wants each link's complete access picture. Only
// populated for views logged after share-link attribution shipped — historical
// events carry no share_link_id, so there's no backfill.
export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export interface ShareLinkAccessEntry {
  id: string;
  label: string | null;
  tokenSuffix: string;          // last 6 chars of the token, to identify unlabeled links
  mode: ShareLinkMode;          // 'full' | 'allocation_only'
  status: ShareLinkStatus;
  createdAt: string;
  expiresAt: string;
  views: number;                // attributed views, all-time
  uniqueVisitors: number;       // distinct IPs among those views
  lastAccessAt: string | null;  // most recent attributed view, or null if never used
  locations: ViewerLocationOccurrence[]; // where the attributed views came from, most-recent first
}

export interface ShareLinkAccessGroup {
  portfolio_id: string;
  totalViews: number;
  links: ShareLinkAccessEntry[];
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

// Anonymous identities are grouped by IP alone (browser/device no longer split
// rows), so the label carries only location + masked IP — no device/browser.
function buildAnonLabel(event: { city: string | null; region: string | null; country: string | null; ip_address: string | null }): string {
  const city = event.city
    ? formatCityLocation(event.city, event.region, event.country)
    : 'Unknown location';
  return `${city} • ${maskIp(event.ip_address)}`;
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

// Total `view` analytics events recorded so far today (Pacific day, the same
// window the analytics dashboard's todayViews uses). A cheap head+count query —
// no rows fetched — surfaced on the public portfolios list so the landing page
// can show a "N views today" social-proof hook beside the movers strip. Counts
// every view event (landing + portfolio detail pages), not unique visitors.
// Returns 0 on error so the hook degrades to hidden rather than breaking the
// list response.
export async function getTodayViewCount(): Promise<number> {
  const todayStart = getSeattleMidnightToday().toISOString();
  const { count, error } = await supabase
    .from('analytics_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'view')
    .gte('created_at', todayStart);
  if (error) {
    console.error('Failed to count today views:', error);
    return 0;
  }
  return count ?? 0;
}

function shareLinkStatus(link: DbShareLink): ShareLinkStatus {
  if (link.revoked_at) return 'revoked';
  if (new Date(link.expires_at) <= new Date()) return 'expired';
  return 'active';
}

// Builds the Shared Link Access panel data: each share link annotated with its
// all-time attributed-view stats, grouped by portfolio. Pure (no I/O) so the
// callers fetch the two inputs; share-link views are anonymous (viewer_id null),
// so the dashboard's excludeViewerIds filter intentionally doesn't apply here.
export function computeShareLinkAccess(
  shareLinks: DbShareLink[],
  linkedEvents: {
    share_link_id: string | null;
    ip_address: string | null;
    created_at: string;
    city: string | null;
    region: string | null;
    country: string | null;
  }[]
): ShareLinkAccessGroup[] {
  // share_link_id -> rolled-up access stats. `locations` keys by city|region|country
  // (same key shape as the Visitor Locations panel) so each distinct place is one row.
  type LinkLocAgg = { city: string | null; region: string | null; country: string | null; count: number; lastSeenAt: string };
  const stats = new Map<
    string,
    { views: number; ips: Set<string>; lastAccessAt: string; locations: Map<string, LinkLocAgg> }
  >();
  for (const e of linkedEvents) {
    if (!e.share_link_id) continue;
    let s = stats.get(e.share_link_id);
    if (!s) {
      s = { views: 0, ips: new Set(), lastAccessAt: e.created_at, locations: new Map() };
      stats.set(e.share_link_id, s);
    }
    s.views++;
    if (e.ip_address) s.ips.add(e.ip_address);
    if (e.created_at > s.lastAccessAt) s.lastAccessAt = e.created_at;

    const city = e.city || null;
    const region = e.region || null;
    const country = e.country || null;
    const locKey = `${city ?? ''}|${region ?? ''}|${country ?? ''}`;
    const loc = s.locations.get(locKey);
    if (loc) {
      loc.count++;
      if (e.created_at > loc.lastSeenAt) loc.lastSeenAt = e.created_at;
    } else {
      s.locations.set(locKey, { city, region, country, count: 1, lastSeenAt: e.created_at });
    }
  }

  const statusRank: Record<ShareLinkStatus, number> = { active: 0, expired: 1, revoked: 2 };
  const byPortfolio = new Map<string, ShareLinkAccessEntry[]>();

  for (const link of shareLinks) {
    const s = stats.get(link.id);
    const views = s?.views ?? 0;
    const status = shareLinkStatus(link);
    // Keep the panel forward-looking and uncluttered: show a link only if it's
    // still live or has actually been accessed. This hides the pile of revoked/
    // expired links that recorded no views (e.g. every historical link on the
    // first deploy, before attribution existed).
    if (status !== 'active' && views === 0) continue;

    const entry: ShareLinkAccessEntry = {
      id: link.id,
      label: link.label,
      tokenSuffix: link.token.slice(-6),
      mode: link.mode,
      status,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      views,
      uniqueVisitors: s?.ips.size ?? 0,
      lastAccessAt: s?.lastAccessAt ?? null,
      locations: s
        ? Array.from(s.locations.values())
            .map((v) => ({
              display: formatLocationLong(v.city, v.region, v.country),
              count: v.count,
              lastSeenAt: v.lastSeenAt,
            }))
            .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        : [],
    };
    const list = byPortfolio.get(link.portfolio_id) || [];
    list.push(entry);
    byPortfolio.set(link.portfolio_id, list);
  }

  const groups: ShareLinkAccessGroup[] = Array.from(byPortfolio.entries()).map(
    ([portfolio_id, links]) => {
      links.sort(
        (a, b) =>
          statusRank[a.status] - statusRank[b.status] ||
          (b.lastAccessAt || '').localeCompare(a.lastAccessAt || '') ||
          b.createdAt.localeCompare(a.createdAt)
      );
      return {
        portfolio_id,
        totalViews: links.reduce((sum, l) => sum + l.views, 0),
        links,
      };
    }
  );
  // Busiest portfolios first; ties broken alphabetically for stable ordering.
  groups.sort((a, b) => b.totalViews - a.totalViews || a.portfolio_id.localeCompare(b.portfolio_id));
  return groups;
}

// PostgREST caps each response at the project's "Max rows" setting (1000 by
// default), so an unpaginated select silently drops rows once the result
// exceeds that. The analytics window routinely holds far more than 1000 events,
// which previously truncated the fetch to the most-recent ~1000 rows and zeroed
// out every day beyond them on the dashboard. Page through with a build callback
// that re-applies the same filters/ordering per page; callers must supply a
// total ordering (e.g. created_at then the uuid id) so no row is skipped or
// duplicated across page boundaries.
const ANALYTICS_PAGE_SIZE = 1000;

async function fetchAllAnalyticsRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += ANALYTICS_PAGE_SIZE) {
    const { data, error } = await build(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < ANALYTICS_PAGE_SIZE) break;
  }
  return rows;
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

  // Fetch all events in the date range, paging past PostgREST's 1000-row cap so
  // older days aren't silently dropped (see fetchAllAnalyticsRows).
  const events = await fetchAllAnalyticsRows<any>((from, to) =>
    supabase
      .from('analytics_events')
      .select('*')
      .gte('created_at', startDateStr)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
  );

  // Share Link Access is computed all-time (not windowed), so it pulls its own
  // inputs: every share link plus every share-link-attributed view. Share links
  // are few, but attributed views can exceed the 1000-row cap over time, so page
  // those too.
  const [shareLinksRes, linkedEvents] = await Promise.all([
    supabase.from('share_links').select('*'),
    fetchAllAnalyticsRows<any>((from, to) =>
      supabase
        .from('analytics_events')
        .select('share_link_id, ip_address, created_at, city, region, country, id')
        .not('share_link_id', 'is', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    ),
  ]);
  if (shareLinksRes.error) throw shareLinksRes.error;
  const shareLinkAccess = computeShareLinkAccess(
    (shareLinksRes.data || []) as DbShareLink[],
    linkedEvents
  );

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

  // Events by day, bucketed in Pacific time so dates match what the dashboard
  // displays (and what the Viewer Activity panels already use).
  const eventsByDayMap = new Map<string, { views: number; logins: number }>();
  for (const event of allEvents) {
    const date = getPacificDateString(event.created_at);
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
  // Most-recent event timestamp per (viewer_id, portfolio_id) bucket, used for the
  // "Last Visited" column.
  const viewerLastVisitMap = new Map<string, string>();
  // Anonymous viewer activity: keyed by (ip, portfolio_id). Every visitor from a
  // given IP collapses into one identity regardless of browser/device — we no
  // longer split desktop vs mobile, which kept the row count down. Carries a
  // representative label (location + masked IP) from the first event we see.
  const anonActivityMap = new Map<string, Record<string, number>>();
  const anonLastVisitMap = new Map<string, string>();
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
      const prev = viewerLastVisitMap.get(key);
      if (!prev || event.created_at > prev) viewerLastVisitMap.set(key, event.created_at);
    } else {
      const identity = event.ip_address || 'unknown';
      const key = `${identity}|${portfolio}`;
      if (!anonActivityMap.has(key)) anonActivityMap.set(key, {});
      const counts = anonActivityMap.get(key)!;
      counts[date] = (counts[date] || 0) + 1;
      const prevAnon = anonLastVisitMap.get(key);
      if (!prevAnon || event.created_at > prevAnon) anonLastVisitMap.set(key, event.created_at);
      if (!anonLabelMap.has(identity)) {
        anonLabelMap.set(identity, buildAnonLabel(event));
      }
    }
  }

  const viewerActivityByDay = Array.from(viewerActivityByDayMap.entries())
    .map(([key, dailyCounts]) => {
      const [viewer_id, portfolio_id] = key.split('|');
      return { viewer_id, portfolio_id, lastVisitAt: viewerLastVisitMap.get(key)!, dailyCounts };
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
        lastVisitAt: anonLastVisitMap.get(key)!,
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

  // Views per portfolio per day (last 5 Pacific days). Null portfolio_id =>
  // LANDING_PORTFOLIO bucket so the landing page ("/") shows up alongside
  // portfolio paths.
  const portfolioActivityMap = new Map<string, Record<string, number>>();
  for (const event of views) {
    if (event.created_at < fiveDaysAgoStr) continue;
    const portfolio = event.portfolio_id || LANDING_PORTFOLIO;
    const date = getPacificDateString(event.created_at);
    if (!portfolioActivityMap.has(portfolio)) portfolioActivityMap.set(portfolio, {});
    const counts = portfolioActivityMap.get(portfolio)!;
    counts[date] = (counts[date] || 0) + 1;
  }
  const portfolioActivityByDay = Array.from(portfolioActivityMap.entries())
    .map(([portfolio_id, dailyCounts]) => ({ portfolio_id, dailyCounts }))
    .sort((a, b) => {
      const aTotal = Object.values(a.dailyCounts).reduce((s, n) => s + n, 0);
      const bTotal = Object.values(b.dailyCounts).reduce((s, n) => s + n, 0);
      return bTotal - aTotal || a.portfolio_id.localeCompare(b.portfolio_id);
    });

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
    portfolioActivityByDay,
    shareLinkAccess,
  };
}

export interface PortfolioDeepResearch {
  deep_research: string | null;
  deep_research_at: string | null;
}

export async function getPortfolioDeepResearch(portfolioId: string): Promise<PortfolioDeepResearch> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('deep_research, deep_research_at')
    .eq('id', portfolioId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || {
    deep_research: null,
    deep_research_at: null,
  };
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
