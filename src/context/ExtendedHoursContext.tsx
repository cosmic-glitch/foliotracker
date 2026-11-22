import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMarketStatus } from '../lib/market-hours';
import type { MarketStatus } from '../types/portfolio';

// Which price basis the figures use, from the live NYSE session state — there
// is no user setting. During the regular session the figures use the live
// regular price; outside it (pre-market, after-hours, overnight, weekends,
// holidays) they use extended-hours prices, for every viewer. The 1D chart
// always draws the full 4 a.m.–8 p.m. day regardless (PerformanceChart).
//
// Outside the session the landing page also offers an "At Close / After
// Hours" switch (SessionSwitch); that pick is landing-local state layered on
// top of `showExtendedHours`, so it never leaks onto the portfolio page.

interface ExtendedHoursContextType {
  // True whenever the regular session is closed.
  showExtendedHours: boolean;
  // Live NYSE session state, re-checked every minute.
  marketStatus: MarketStatus;
}

const ExtendedHoursContext = createContext<ExtendedHoursContextType | undefined>(undefined);

const MARKET_RECHECK_MS = 60 * 1000;

export function ExtendedHoursProvider({ children }: { children: ReactNode }) {
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

  const showExtendedHours = marketStatus !== 'open';

  return (
    <ExtendedHoursContext.Provider value={{ showExtendedHours, marketStatus }}>
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
