#!/usr/bin/env npx tsx
/**
 * Persist the generated Upcoming Events feed to Supabase.
 * Reads scripts/events-output/events.json (written by the generator session)
 * and replaces the whole upcoming_events set in one shot.
 *
 * Usage:
 *   npx tsx scripts/save-events.ts [scripts/events-output/events.json]
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (source .env.local).
 */

import fs from 'fs';
import {
  replaceUpcomingEvents,
  type DbUpcomingEvent,
  type UpcomingEventSource,
} from '../api/_lib/db.js';

const DEFAULT_PATH = 'scripts/events-output/events.json';

const EVENT_TYPES = new Set(['macro', 'earnings']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `importance` is vestigial. Nothing reads it — not the strip (which renders a
// plain date | emoji | title statement with no severity encoding), not the API,
// not the ranking (see sortRows below). It survives only as a NOT NULL column on
// `upcoming_events`, so we write a constant rather than ask the generator to
// classify. Kept out of events-prompt.md entirely: a field the model must invent
// but nobody consumes is just a place for drift.
const DEFAULT_IMPORTANCE = 'medium' as const;

// Titles render on a single line in a narrow mobile column; longer ones clip
// with an ellipsis. The generator (events-prompt.md) is instructed to keep every
// title ≤ this; we don't reject here (one over-long title shouldn't nuke the
// whole feed), but we warn so prompt drift is visible in the cron log. Keep in
// sync with the ≤ 32 char rule in events-prompt.md.
const TITLE_MAX = 32;

interface RawEvent {
  id?: unknown;
  type?: unknown;
  date?: unknown;
  time?: unknown;
  title?: unknown;
  detail?: unknown;
  tickers?: unknown;
  holders?: unknown;
  holder_count?: unknown;
  source?: unknown;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseSource(v: unknown): UpcomingEventSource | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as { title?: unknown; url?: unknown };
  if (typeof s.title === 'string' && typeof s.url === 'string') {
    return { title: s.title, url: s.url };
  }
  return null;
}

function toRow(raw: RawEvent, i: number): Omit<DbUpcomingEvent, 'generated_at'> {
  const type = String(raw.type);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`event[${i}]: missing id`);
  if (!EVENT_TYPES.has(type)) throw new Error(`event[${i}] (${raw.id}): bad type "${raw.type}"`);
  if (typeof raw.date !== 'string' || !DATE_RE.test(raw.date)) {
    throw new Error(`event[${i}] (${raw.id}): bad date "${raw.date}" (want YYYY-MM-DD)`);
  }
  if (typeof raw.title !== 'string' || !raw.title) throw new Error(`event[${i}] (${raw.id}): missing title`);

  const holders = raw.holders == null ? null : asStringArray(raw.holders);

  return {
    id: raw.id,
    event_type: type as 'macro' | 'earnings',
    event_date: raw.date,
    event_time: typeof raw.time === 'string' && raw.time ? raw.time : null,
    title: raw.title,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    importance: DEFAULT_IMPORTANCE,
    tickers: asStringArray(raw.tickers),
    holders,
    holder_count: typeof raw.holder_count === 'number' ? raw.holder_count : holders?.length ?? 0,
    source: parseSource(raw.source),
    position: 0, // assigned by sortRows below
  };
}

/**
 * Rank the feed and stamp `position` (the display order the strip slices).
 *
 * Sorted here, not in the generator: ordering is pure arithmetic over fields we
 * already have, so it should be deterministic rather than a thing the model
 * re-derives (and occasionally gets wrong) each run. The prompt still emits
 * roughly this order for the human-readable preview; this is the authority.
 *
 *   1. date ascending — the strip answers "what's coming next?", and with
 *      DISPLAY_COUNT = 1 the nearest event is the one row the landing page shows.
 *   2. macro before earnings within a date — a Fed decision or CPI print moves
 *      every portfolio; one company's earnings moves the handful that hold it.
 *      This replaces the old importance tiebreak, which sorted macro LAST on a
 *      shared date: macro rows always carry holder_count 0, so breadth-descending
 *      pushed the FOMC decision below Meta and Microsoft on 2026-07-29.
 *   3. holder_count descending — among earnings on one date, the most widely
 *      held name leads.
 *   4. id ascending — total order, so a rerun with unchanged input produces
 *      byte-identical positions.
 */
function sortRows(
  rows: Omit<DbUpcomingEvent, 'generated_at'>[]
): Omit<DbUpcomingEvent, 'generated_at'>[] {
  return [...rows]
    .sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) ||
        Number(a.event_type === 'earnings') - Number(b.event_type === 'earnings') ||
        b.holder_count - a.holder_count ||
        a.id.localeCompare(b.id)
    )
    .map((r, i) => ({ ...r, position: i }));
}

async function main() {
  const path = process.argv[2] || DEFAULT_PATH;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  if (!fs.existsSync(path)) {
    console.error(`No events file at ${path} — nothing to save.`);
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error('events.json must be a JSON array');
    process.exit(1);
  }

  const rows = sortRows((parsed as RawEvent[]).map(toRow));

  const tooLong = rows.filter((r) => r.title.length > TITLE_MAX);
  if (tooLong.length) {
    console.warn(
      `warning: ${tooLong.length} title(s) exceed ${TITLE_MAX} chars and will clip on mobile:`
    );
    for (const r of tooLong) console.warn(`  [${r.title.length}] ${r.title}`);
  }

  await replaceUpcomingEvents(rows);

  const macro = rows.filter((r) => r.event_type === 'macro').length;
  const earnings = rows.length - macro;
  console.log(`saved: ${rows.length} events (${macro} macro, ${earnings} earnings) from ${path}`);
  // The lead row is the only one the collapsed strip shows — log it so a bad
  // ranking is visible in the cron log without querying the table.
  if (rows[0]) console.log(`  lead: ${rows[0].event_date} ${rows[0].title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
