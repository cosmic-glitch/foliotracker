import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Global 1D/30D view setting. Mirrors ExtendedHoursContext in shape and is
// surfaced from the same place (UserMenu's check rows). One source of truth
// means the landing page's Users table and a portfolio's TotalValue headline
// + chart all stay in sync.
//
// Deliberately session-only (in-memory, no storage): the toggle lives in a
// hidden menu, so a persisted 30D pick could leave someone silently stuck in
// 30-day view across visits without realizing why. Switching applies for the
// current page session; every fresh load starts back at the 1D default, and
// returning to an already-loaded page (visibilitychange → visible, e.g.
// app-switching back to the iOS home-screen app, where the page stays alive)
// also resets — the same signal that counts a new view in useAnalytics, so
// "counted as a view" and "back at the default" stay in lockstep.
//
// Logged-out viewers don't see UserMenu today (same as Theme and Extended
// Hours), so they always get the 1D default — an accepted limitation,
// consistent with the other view settings.

export type Timeframe = 'day' | '30d';

interface TimeframeContextType {
  timeframe: Timeframe;
  setTimeframe: (next: Timeframe) => void;
  toggleTimeframe: () => void;
}

const TimeframeContext = createContext<TimeframeContextType | undefined>(undefined);

// Key the pre-session-only implementation persisted to. Cleared on mount so
// visitors stuck in 30D by the old behavior don't keep a stale value around.
const LEGACY_STORAGE_KEY = 'landingTimeframe';

export function TimeframeProvider({ children }: { children: ReactNode }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('day');

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTimeframe('day');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

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
