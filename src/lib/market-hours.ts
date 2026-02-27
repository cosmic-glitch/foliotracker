const ET_TIMEZONE = 'America/New_York';
const PRE_MARKET_OPEN_MINUTES = 4 * 60;
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const AFTER_HOURS_CLOSE_MINUTES = 20 * 60;

const ET_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
});

const ET_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  timeZoneName: 'shortOffset',
});

interface ETParts {
  weekday: number;
  minutesFromMidnight: number;
}

function parseWeekday(value: string): number {
  switch (value) {
    case 'Sun': return 0;
    case 'Mon': return 1;
    case 'Tue': return 2;
    case 'Wed': return 3;
    case 'Thu': return 4;
    case 'Fri': return 5;
    case 'Sat': return 6;
    default: return -1;
  }
}

function getETParts(now: Date): ETParts {
  const parts = ET_PARTS_FORMATTER.formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.get('hour') ?? '0');
  const minute = Number(map.get('minute') ?? '0');
  const weekday = parseWeekday(map.get('weekday') ?? '');

  return {
    weekday,
    minutesFromMidnight: hour * 60 + minute,
  };
}

export function getETOffset(now: Date = new Date()): number {
  const offsetPart = ET_OFFSET_FORMATTER
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return -5;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  return sign * (hours + minutes / 60);
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const et = getETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= MARKET_OPEN_MINUTES && et.minutesFromMidnight < MARKET_CLOSE_MINUTES;
}

export function isPreMarket(now: Date = new Date()): boolean {
  const et = getETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= PRE_MARKET_OPEN_MINUTES && et.minutesFromMidnight < MARKET_OPEN_MINUTES;
}

export function isAfterHours(now: Date = new Date()): boolean {
  const et = getETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= MARKET_CLOSE_MINUTES && et.minutesFromMidnight < AFTER_HOURS_CLOSE_MINUTES;
}

export function isLiveMarketSession(now: Date = new Date()): boolean {
  return isPreMarket(now) || isMarketOpen(now) || isAfterHours(now);
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

export function getMarketStatus(now: Date = new Date()): 'open' | 'pre-market' | 'after-hours' | 'closed' {
  if (isMarketOpen(now)) return 'open';
  if (isPreMarket(now)) return 'pre-market';
  if (isAfterHours(now)) return 'after-hours';
  return 'closed';
}
