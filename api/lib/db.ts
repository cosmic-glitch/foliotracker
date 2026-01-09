import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

const MAX_PORTFOLIOS = 10;
const SALT_ROUNDS = 10;

export interface DbPortfolio {
  id: string;
  display_name: string | null;
  password_hash: string;
  created_at: string;
  is_private: boolean;
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

export interface DbPriceCache {
  ticker: string;
  current_price: number;
  previous_close: number;
  updated_at: string;
}

export interface DbDailyPrice {
  ticker: string;
  date: string;
  close_price: number;
}

// Portfolio functions
export async function getPortfolios(): Promise<Omit<DbPortfolio, 'password_hash'>[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, display_name, created_at, is_private')
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
  isPrivate?: boolean
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
    is_private: isPrivate ?? false,
  });

  if (error) throw error;
}

export async function verifyPortfolioPassword(
  id: string,
  password: string
): Promise<boolean> {
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
  settings: { is_private?: boolean; display_name?: string }
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

export async function getCachedPrices(): Promise<Map<string, DbPriceCache>> {
  const { data, error } = await supabase.from('price_cache').select('*');

  if (error) throw error;

  const map = new Map<string, DbPriceCache>();
  for (const price of data || []) {
    map.set(price.ticker, price);
  }
  return map;
}

export async function updatePriceCache(
  ticker: string,
  currentPrice: number,
  previousClose: number
): Promise<void> {
  const { error } = await supabase.from('price_cache').upsert(
    {
      ticker,
      current_price: currentPrice,
      previous_close: previousClose,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'ticker' }
  );

  if (error) throw error;
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
