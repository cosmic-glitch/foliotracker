const ET_TIMEZONE = 'America/New_York';
const PRE_MARKET_OPEN_MINUTES = 4 * 60;
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const AFTER_HOURS_CLOSE_MINUTES = 20 * 60;

// ── NYSE market calendar ──────────────────────────────────────────────────
// Full-day closures and 1:00 p.m. early-close half-days, keyed on ET calendar
// day (YYYY-MM-DD). Sourced from the official NYSE calendar
// (nyse.com/markets/hours-calendars), seeded through 2028; weekend-observed
// dates follow NYSE's rule (a Saturday holiday is observed the preceding
// Friday as a full closure — e.g. 2026-07-03 for the Sat July 4).
//
// DUPLICATED VERBATIM in api/_lib/cache.ts because the serverless API and the
// Vite client are separate build targets with no shared module. Keep the two
// copies identical — tests/calendar-sync.spec.ts fails on any drift. Extend
// both each year from the official calendar before the seeded range runs out.
export const MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  // 2028 (New Year's Day Jan 1 is a Saturday — not observed)
  '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
  '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
]);

// date → regular-session close in ET minutes-from-midnight (1:00 p.m. = 780).
export const MARKET_EARLY_CLOSES: ReadonlyMap<string, number> = new Map([
  ['2026-11-27', 780], ['2026-12-24', 780], // 2026: day after Thanksgiving, Christmas Eve
  ['2027-11-26', 780],                       // 2027: day after Thanksgiving
  ['2028-07-03', 780], ['2028-11-24', 780],  // 2028: day before July 4, day after Thanksgiving
]);

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

function getETParts(now: Date): ETParts {
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

// A date the market trades at all (any session): a weekday that isn't a
// holiday. Early-close half-days are still trading days.
function isTradingDay(et: ETParts): boolean {
  if (et.weekday < 1 || et.weekday > 5) return false;
  return !MARKET_HOLIDAYS.has(et.dateKey);
}

// Regular-session close for a date, in ET minutes-from-midnight: 1:00 p.m. on
// early-close half-days, otherwise the normal 4:00 p.m.
function regularCloseMinutes(dateKey: string): number {
  return MARKET_EARLY_CLOSES.get(dateKey) ?? MARKET_CLOSE_MINUTES;
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
  if (!isTradingDay(et)) return false;
  return et.minutesFromMidnight >= MARKET_OPEN_MINUTES && et.minutesFromMidnight < regularCloseMinutes(et.dateKey);
}

export function isPreMarket(now: Date = new Date()): boolean {
  const et = getETParts(now);
  if (!isTradingDay(et)) return false;
  return et.minutesFromMidnight >= PRE_MARKET_OPEN_MINUTES && et.minutesFromMidnight < MARKET_OPEN_MINUTES;
}

export function isAfterHours(now: Date = new Date()): boolean {
  const et = getETParts(now);
  if (!isTradingDay(et)) return false;
  return et.minutesFromMidnight >= regularCloseMinutes(et.dateKey) && et.minutesFromMidnight < AFTER_HOURS_CLOSE_MINUTES;
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
