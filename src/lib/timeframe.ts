// Shared 1D/30D timeframe pill state. Used by the landing page Users table and
// by the per-portfolio view. One localStorage key means the choice carries
// across both surfaces, and the "default when market is closed" rule (1D is
// stale → prefer 30D) stays consistent.

import { isLiveMarketSession } from './market-hours';

export type Timeframe = 'day' | '30d';

export const TIMEFRAME_STORAGE_KEY = 'landingTimeframe';

export function loadInitialTimeframe(): Timeframe {
  if (typeof window === 'undefined') return 'day';
  const stored = window.localStorage.getItem(TIMEFRAME_STORAGE_KEY);
  if (stored === 'day' || stored === '30d') return stored;
  // Default: 1D when the market is live (intraday context matters), 30D
  // otherwise (1D is stale anyway when the market is closed).
  return isLiveMarketSession() ? 'day' : '30d';
}

export function persistTimeframe(timeframe: Timeframe): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TIMEFRAME_STORAGE_KEY, timeframe);
}
