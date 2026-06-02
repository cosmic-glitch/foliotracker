import { createContext, useContext, useState, type ReactNode } from 'react';
import { isLiveMarketSession } from '../lib/market-hours';

// Global 1D/30D view setting. Mirrors ExtendedHoursContext in shape and is
// surfaced from the same place (UserMenu's check rows). One source of truth
// means the landing page's Users table and a portfolio's TotalValue headline
// + chart all stay in sync, and the pick survives reloads.
//
// Logged-out viewers don't see UserMenu today (same as Theme and Extended
// Hours), so they get whatever the default-for-market-state rule picks and
// can't change it — this is an accepted limitation, consistent with the
// other view settings.

export type Timeframe = 'day' | '30d';

interface TimeframeContextType {
  timeframe: Timeframe;
  setTimeframe: (next: Timeframe) => void;
  toggleTimeframe: () => void;
}

const TimeframeContext = createContext<TimeframeContextType | undefined>(undefined);

// Kept as 'landingTimeframe' so values written by the prior inline-pill
// implementation continue to apply — no migration needed.
const STORAGE_KEY = 'landingTimeframe';

function loadInitial(): Timeframe {
  if (typeof window === 'undefined') return 'day';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'day' || stored === '30d') return stored;
  // First visit: 1D when the market is live (intraday context matters), 30D
  // otherwise (1D is stale anyway when the market is closed).
  return isLiveMarketSession() ? 'day' : '30d';
}

export function TimeframeProvider({ children }: { children: ReactNode }) {
  const [timeframe, setTimeframeState] = useState<Timeframe>(loadInitial);

  const setTimeframe = (next: Timeframe) => {
    setTimeframeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  const toggleTimeframe = () => {
    setTimeframe(timeframe === 'day' ? '30d' : 'day');
  };

  return (
    <TimeframeContext.Provider value={{ timeframe, setTimeframe, toggleTimeframe }}>
      {children}
    </TimeframeContext.Provider>
  );
}

export function useTimeframe() {
  const context = useContext(TimeframeContext);
  if (!context) {
    throw new Error('useTimeframe must be used within a TimeframeProvider');
  }
  return context;
}
