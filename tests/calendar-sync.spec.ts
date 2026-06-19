import { test, expect } from '@playwright/test';
import {
  MARKET_HOLIDAYS as API_HOLIDAYS,
  MARKET_EARLY_CLOSES as API_EARLY_CLOSES,
} from '../api/_lib/cache';
import {
  MARKET_HOLIDAYS as CLIENT_HOLIDAYS,
  MARKET_EARLY_CLOSES as CLIENT_EARLY_CLOSES,
} from '../src/lib/market-hours';

// The NYSE market calendar is intentionally duplicated across the serverless
// API (api/_lib/cache.ts) and the Vite client (src/lib/market-hours.ts) because
// they are separate build targets with no shared module. These checks fail the
// moment the two copies drift apart, so an annual update to one side that
// forgets the other gets caught instead of silently shipping.
//
// Pure logic — no browser needed. Run with: npx playwright test calendar-sync
test.describe('NYSE market calendar', () => {
  test('holiday set is identical between API and client copies', () => {
    expect([...API_HOLIDAYS].sort()).toEqual([...CLIENT_HOLIDAYS].sort());
  });

  test('early-close map is identical between API and client copies', () => {
    const sortEntries = (m: ReadonlyMap<string, number>) =>
      [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(sortEntries(API_EARLY_CLOSES)).toEqual(sortEntries(CLIENT_EARLY_CLOSES));
  });

  test('every calendar date is a well-formed YYYY-MM-DD key', () => {
    const keys = [...API_HOLIDAYS, ...API_EARLY_CLOSES.keys()];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key, `malformed date key: ${key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('early-close times fall between the open and the normal close', () => {
    for (const [date, mins] of API_EARLY_CLOSES) {
      expect(mins, `early close ${date} not after 9:30`).toBeGreaterThan(9 * 60 + 30);
      expect(mins, `early close ${date} not before 16:00`).toBeLessThan(16 * 60);
    }
  });

  test('no date is both a full holiday and an early close', () => {
    for (const date of API_EARLY_CLOSES.keys()) {
      expect(API_HOLIDAYS.has(date), `${date} is listed as both`).toBe(false);
    }
  });
});
