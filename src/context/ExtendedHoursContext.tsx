import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMarketStatus } from '../lib/market-hours';
import type { MarketStatus } from '../types/portfolio';

// Extended-hours prices are always shown outside the regular session
// (pre-market, after-hours, overnight, weekends, holidays) — nobody checking
// in after the bell wants to miss the after-hours move. The stored preference
// ("Extended Hours All Day" in UserMenu) only decides whether they're ALSO
// shown while the regular session is open, where the pre-market tape can be
// noise. Every consumer reads the effective `showExtendedHours`; only the
// menu checkbox reads `extendedHoursAllDay`. Logged-out viewers (no menu) get
// the default preference, so they too see extended hours outside the session.
//
// Outside the session the landing page also offers an "At Close / After
// Hours" switch (SessionSwitch); that pick is landing-local state layered on
// top of `showExtendedHours`, so it never leaks onto the portfolio page.

interface ExtendedHoursContextType {
  // Effective: in session, the All Day preference; outside it, always on.
  showExtendedHours: boolean;
  // The stored preference, for the menu checkbox.
  extendedHoursAllDay: boolean;
  toggleExtendedHours: () => void;
  // Live NYSE session state, re-checked every minute.
  marketStatus: MarketStatus;
}

const ExtendedHoursContext = createContext<ExtendedHoursContextType | undefined>(undefined);

const STORAGE_KEY = 'foliotracker-extended-hours';
const MARKET_RECHECK_MS = 60 * 1000;

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function ExtendedHoursProvider({ children }: { children: ReactNode }) {
  // Hydrated synchronously (lazy initializer), per the storage-hook rule.
  const [extendedHoursAllDay, setExtendedHoursAllDay] = useState<boolean>(readPreference);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getMarketStatus());

  // Flip at the open/close without a reload: poll once a minute, and recheck
  // on return to the tab (timers are throttled in background tabs and the iOS
  // home-screen app can sit suspended for hours).
  useEffect(() => {
    const recheck = () => setMarketStatus(getMarketStatus());
    const id = window.setInterval(recheck, MARKET_RECHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const toggleExtendedHours = () => {
    setExtendedHoursAllDay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Storage unavailable — the choice still applies for this session.
      }
      return next;
    });
  };

  const showExtendedHours = extendedHoursAllDay || marketStatus !== 'open';

  return (
    <ExtendedHoursContext.Provider
      value={{ showExtendedHours, extendedHoursAllDay, toggleExtendedHours, marketStatus }}
    >
      {children}
    </ExtendedHoursContext.Provider>
  );
}

export function useExtendedHours() {
  const context = useContext(ExtendedHoursContext);
  if (!context) {
    throw new Error('useExtendedHours must be used within an ExtendedHoursProvider');
  }
  return context;
}
