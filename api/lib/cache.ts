// US Eastern timezone utilities
export function getETOffset(): number {
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = now.getTimezoneOffset() < stdOffset;
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

  if (etHours < 0) return utcDay === 0 ? 6 : utcDay - 1;
  if (etHours >= 24) return (utcDay + 1) % 7;
  return utcDay;
}

// Get start of trading day in US Eastern Time as a Date object
// This correctly handles the timezone boundary (e.g., after 7 PM ET / midnight UTC)
export function getStartOfTradingDay(): Date {
  const now = new Date();
  const etOffset = getETOffset(); // -5 for EST, -4 for EDT

  // Get current time in ET
  const utcHours = now.getUTCHours();
  const etHours = utcHours + etOffset;

  // Start with current date
  const startOfDay = new Date(now);

  // If it's still the previous day in ET (negative hours), adjust the date
  if (etHours < 0) {
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  }

  // Set to midnight ET (which is -etOffset hours in UTC)
  // e.g., midnight ET = 5 AM UTC (EST) or 4 AM UTC (EDT)
  startOfDay.setUTCHours(-etOffset, 0, 0, 0);

  return startOfDay;
}

export function isMarketOpen(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) return false;

  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;

  return totalMinutes >= marketOpen && totalMinutes < marketClose;
}

export function isPreMarket(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) return false;

  const preMarketOpen = 4 * 60;
  const marketOpen = 9 * 60 + 30;

  return totalMinutes >= preMarketOpen && totalMinutes < marketOpen;
}

export function isAfterHours(): boolean {
  const day = getETDay();
  const hours = getETHours();
  const minutes = new Date().getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) return false;

  const marketClose = 16 * 60;
  const afterHoursClose = 20 * 60;

  return totalMinutes >= marketClose && totalMinutes < afterHoursClose;
}

export function getMarketStatus(): 'open' | 'pre-market' | 'after-hours' | 'closed' {
  if (isMarketOpen()) return 'open';
  if (isPreMarket()) return 'pre-market';
  if (isAfterHours()) return 'after-hours';
  return 'closed';
}
