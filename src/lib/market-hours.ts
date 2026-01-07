// US Eastern timezone offset (EST: -5, EDT: -4)
function getETOffset(): number {
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = now.getTimezoneOffset() < stdOffset;
  // Return offset from UTC in hours
  return isDST ? -4 : -5;
}

function getETHours(): number {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const etOffset = getETOffset();
  let etHours = utcHours + etOffset;
  if (etHours < 0) etHours += 24;
  if (etHours >= 24) etHours -= 24;
  return etHours;
}

function getETDay(): number {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHours = now.getUTCHours();
  const etOffset = getETOffset();
  const etHours = utcHours + etOffset;

  if (etHours < 0) {
    // Previous day in ET
    return utcDay === 0 ? 6 : utcDay - 1;
  }
  if (etHours >= 24) {
    // Next day in ET
    return (utcDay + 1) % 7;
  }
  return utcDay;
}

export function isMarketOpen(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Weekend
  if (day === 0 || day === 6) return false;

  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM

  return totalMinutes >= marketOpen && totalMinutes < marketClose;
}

export function isPreMarket(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Weekend
  if (day === 0 || day === 6) return false;

  // Pre-market: 4:00 AM - 9:30 AM ET
  const preMarketOpen = 4 * 60; // 4:00 AM
  const marketOpen = 9 * 60 + 30; // 9:30 AM

  return totalMinutes >= preMarketOpen && totalMinutes < marketOpen;
}

export function isAfterHours(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Weekend
  if (day === 0 || day === 6) return false;

  // After hours: 4:00 PM - 8:00 PM ET
  const marketClose = 16 * 60; // 4:00 PM
  const afterHoursClose = 20 * 60; // 8:00 PM

  return totalMinutes >= marketClose && totalMinutes < afterHoursClose;
}

export function getCacheTTL(): number {
  if (isMarketOpen()) {
    return 5 * 60 * 1000; // 5 minutes
  }
  if (isPreMarket()) {
    return 5 * 60 * 1000; // 5 minutes
  }
  if (isAfterHours()) {
    return 15 * 60 * 1000; // 15 minutes
  }
  // Market closed - cache until next market open
  return 60 * 60 * 1000; // 1 hour (will be refreshed at market open)
}

export function getMarketStatus(): 'open' | 'pre-market' | 'after-hours' | 'closed' {
  if (isMarketOpen()) return 'open';
  if (isPreMarket()) return 'pre-market';
  if (isAfterHours()) return 'after-hours';
  return 'closed';
}
