import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

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
}

// Portfolio functions
export async function getPortfolios(): Promise<DbPortfolioListItem[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, display_name, created_at, is_private, visibility')
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
  settings: { is_private?: boolean; display_name?: string; password_hash?: string; visibility?: Visibility }
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

  // Delete existing holdings for this portfolio
  const { error: deleteError } = await supabase
    .from('holdings')
    .delete()
    .eq('portfolio_id', normalizedId);

  if (deleteError) throw deleteError;

  // Insert new holdings
  if (holdings.length > 0) {
    const { error: insertError } = await supabase.from('holdings').insert(
      holdings.map((h) => ({
        ...h,
        portfolio_id: normalizedId,
      }))
    );

    if (insertError) throw insertError;
  }
}

export async function getDailyPrices(
  tickers: string[],
  days: number = 30
): Promise<DbDailyPrice[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('daily_prices')
    .select('*')
    .in('ticker', tickers)
    .gte('date', startDate.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
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
  isStatic: boolean;
  instrumentType: string;
  costBasis: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
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
  benchmark_30d_json: BenchmarkDataPoint[] | null;
  market_status: string;
  updated_at: string;
  last_error: string | null;
  last_error_at: string | null;
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
  topLocations: { location: string; count: number }[];
  viewerActivityByDay: {
    viewer_id: string;
    portfolio_id: string;
    dailyCounts: Record<string, number>; // { "2026-01-27": 3, "2026-01-26": 1, ... }
  }[];
  deviceTypes: { device: string; count: number }[];
  viewerDeviceBreakdown: { viewer_id: string; desktop: number; mobile: number }[];
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

export async function getAnalyticsData(days: number = 30): Promise<AnalyticsAggregation> {
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

  const allEvents = events || [];

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

  // Top locations (city-level)
  const locationMap = new Map<string, number>();
  for (const event of allEvents) {
    if (event.city && event.country) {
      const key = event.region
        ? `${event.city}, ${event.region}, ${event.country}`
        : `${event.city}, ${event.country}`;
      locationMap.set(key, (locationMap.get(key) || 0) + 1);
    }
  }
  const topLocations = Array.from(locationMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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

  // Map: "viewer_id|portfolio_id" -> { date -> count }
  const viewerActivityByDayMap = new Map<string, Record<string, number>>();
  const viewsAndLogins = allEvents.filter((e) => e.event_type === 'view' || e.event_type === 'login');
  for (const event of viewsAndLogins) {
    if (event.viewer_id && event.portfolio_id && event.created_at >= fiveDaysAgoStr) {
      const key = `${event.viewer_id}|${event.portfolio_id}`;
      const date = getPacificDateString(event.created_at);
      if (!viewerActivityByDayMap.has(key)) {
        viewerActivityByDayMap.set(key, {});
      }
      const dailyCounts = viewerActivityByDayMap.get(key)!;
      dailyCounts[date] = (dailyCounts[date] || 0) + 1;
    }
  }

  // Convert to array, sort by viewer_id
  const viewerActivityByDay = Array.from(viewerActivityByDayMap.entries())
    .map(([key, dailyCounts]) => {
      const [viewer_id, portfolio_id] = key.split('|');
      return { viewer_id, portfolio_id, dailyCounts };
    })
    .sort((a, b) => a.viewer_id.localeCompare(b.viewer_id) || a.portfolio_id.localeCompare(b.portfolio_id))
    .slice(0, 15);

  // Device type breakdown
  const deviceMap = new Map<string, number>();
  for (const event of allEvents) {
    const device = getDeviceType(event.user_agent);
    deviceMap.set(device, (deviceMap.get(device) || 0) + 1);
  }
  const deviceTypes = Array.from(deviceMap.entries())
    .map(([device, count]) => ({ device, count }))
    .sort((a, b) => b.count - a.count);

  // Per-viewer device breakdown
  const viewerDeviceMap = new Map<string, { desktop: number; mobile: number }>();
  for (const event of allEvents) {
    if (!event.viewer_id) continue;
    const device = getDeviceType(event.user_agent);
    if (!viewerDeviceMap.has(event.viewer_id)) {
      viewerDeviceMap.set(event.viewer_id, { desktop: 0, mobile: 0 });
    }
    const counts = viewerDeviceMap.get(event.viewer_id)!;
    if (device === 'Desktop') {
      counts.desktop++;
    } else if (device === 'Mobile' || device === 'Tablet') {
      counts.mobile++;
    }
  }
  const viewerDeviceBreakdown = Array.from(viewerDeviceMap.entries())
    .map(([viewer_id, counts]) => ({ viewer_id, ...counts }))
    .sort((a, b) => (b.desktop + b.mobile) - (a.desktop + a.mobile))
    .slice(0, 15);

  return {
    totalViews: views.length,
    totalLogins: logins.length,
    uniqueVisitors: uniqueIPs.size,
    todayViews: todayViews.length,
    todayLogins: todayLogins.length,
    eventsByDay,
    topLocations,
    viewerActivityByDay,
    deviceTypes,
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
