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

// Get start of most recent trading day in US Eastern Time as a Date object
// Returns the most recent trading session start:
// - After 9:30 AM ET on a weekday: Returns today's midnight ET
// - Before 9:30 AM ET on a weekday: Returns previous day's midnight ET
// - On weekends: Returns Friday's midnight ET
export function getStartOfTradingDay(): Date {
  const now = new Date();
  const etOffset = getETOffset(); // -5 for EST, -4 for EDT
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const etHours = utcHours + etOffset;

  // Normalize ET hours to 0-24 range and track day adjustment
  let normalizedEtHours = etHours;
  let dayAdjust = 0;
  if (normalizedEtHours < 0) {
    normalizedEtHours += 24;
    dayAdjust = -1;
  }

  // Calculate current time in minutes from midnight ET
  const etMinutesFromMidnight = normalizedEtHours * 60 + utcMinutes;

  // Market opens at 9:30 AM ET = 570 minutes from midnight
  const marketOpenMinutes = 9 * 60 + 30;

  const startOfDay = new Date(now);

  // Adjust for UTC/ET day boundary
  startOfDay.setUTCDate(startOfDay.getUTCDate() + dayAdjust);

  // If before market open, go back one more day to get previous trading day
  if (etMinutesFromMidnight < marketOpenMinutes) {
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  }

  // Set to midnight ET (which is -etOffset hours in UTC)
  // e.g., midnight ET = 5 AM UTC (EST) or 4 AM UTC (EDT)
  startOfDay.setUTCHours(-etOffset, 0, 0, 0);

  // Handle weekends: go back to Friday
  // getUTCDay() after setting to midnight ET will give us the correct ET day
  const dayOfWeek = startOfDay.getUTCDay();
  if (dayOfWeek === 0) {
    // Sunday -> go back 2 days to Friday
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 2);
  } else if (dayOfWeek === 6) {
    // Saturday -> go back 1 day to Friday
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  }

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
