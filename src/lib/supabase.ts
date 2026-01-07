import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Using mock data.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface DbHolding {
  ticker: string;
  name: string;
  shares: number;
  is_static: boolean;
  static_value: number | null;
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
