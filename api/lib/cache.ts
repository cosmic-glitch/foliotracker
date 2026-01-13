// US Eastern timezone utilities
function getETOffset(): number {
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
