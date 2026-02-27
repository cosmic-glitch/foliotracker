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
  dateKey: string;
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

function parseETParts(now: Date): ETParts {
  const parts = ET_PARTS_FORMATTER.formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = map.get('year') ?? '1970';
  const month = map.get('month') ?? '01';
  const day = map.get('day') ?? '01';
  const hour = Number(map.get('hour') ?? '0');
  const minute = Number(map.get('minute') ?? '0');
  const weekday = parseWeekday(map.get('weekday') ?? '');

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday,
    minutesFromMidnight: hour * 60 + minute,
  };
}

function shiftDateKey(dateKey: string, dayDelta: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().split('T')[0];
}

function isWeekendDateKey(dateKey: string): boolean {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function previousTradingDateKey(dateKey: string): string {
  let cursor = dateKey;
  do {
    cursor = shiftDateKey(cursor, -1);
  } while (isWeekendDateKey(cursor));
  return cursor;
}

function mostRecentTradingSessionDateKey(now: Date): string {
  const et = parseETParts(now);

  if (et.weekday === 0) return shiftDateKey(et.dateKey, -2);
  if (et.weekday === 6) return shiftDateKey(et.dateKey, -1);

  if (et.minutesFromMidnight < PRE_MARKET_OPEN_MINUTES) {
    return previousTradingDateKey(et.dateKey);
  }

  return et.dateKey;
}

function parseOffsetToIso(offsetPart: string): string {
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return '-05:00';

  const sign = match[1];
  const hours = match[2].padStart(2, '0');
  const minutes = (match[3] ?? '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function getETOffsetIsoForDate(dateKey: string): string {
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const offsetPart = ET_OFFSET_FORMATTER
    .formatToParts(probe)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';

  return parseOffsetToIso(offsetPart);
}

function createETDate(dateKey: string, hour: number, minute: number): Date {
  const offsetIso = getETOffsetIsoForDate(dateKey);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dateKey}T${hh}:${mm}:00${offsetIso}`);
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

export function getCurrentTradingSessionRange(now: Date = new Date()): { start: Date; end: Date; tradingDate: string } {
  const tradingDate = mostRecentTradingSessionDateKey(now);
  return {
    tradingDate,
    start: createETDate(tradingDate, 4, 0),
    end: createETDate(tradingDate, 20, 0),
  };
}

export function getStartOfTradingDay(now: Date = new Date()): Date {
  return getCurrentTradingSessionRange(now).start;
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const et = parseETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= MARKET_OPEN_MINUTES && et.minutesFromMidnight < MARKET_CLOSE_MINUTES;
}

export function isPreMarket(now: Date = new Date()): boolean {
  const et = parseETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= PRE_MARKET_OPEN_MINUTES && et.minutesFromMidnight < MARKET_OPEN_MINUTES;
}

export function isAfterHours(now: Date = new Date()): boolean {
  const et = parseETParts(now);
  if (et.weekday < 1 || et.weekday > 5) return false;
  return et.minutesFromMidnight >= MARKET_CLOSE_MINUTES && et.minutesFromMidnight < AFTER_HOURS_CLOSE_MINUTES;
}

export function isLiveMarketSession(now: Date = new Date()): boolean {
  return isPreMarket(now) || isMarketOpen(now) || isAfterHours(now);
}

export function getMarketStatus(now: Date = new Date()): 'open' | 'pre-market' | 'after-hours' | 'closed' {
  if (isMarketOpen(now)) return 'open';
  if (isPreMarket(now)) return 'pre-market';
  if (isAfterHours(now)) return 'after-hours';
  return 'closed';
}
