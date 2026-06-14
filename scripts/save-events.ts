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
const IMPORTANCES = new Set(['high', 'medium', 'low']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RawEvent {
  id?: unknown;
  type?: unknown;
  date?: unknown;
  time?: unknown;
  title?: unknown;
  detail?: unknown;
  importance?: unknown;
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
  const importance = String(raw.importance);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`event[${i}]: missing id`);
  if (!EVENT_TYPES.has(type)) throw new Error(`event[${i}] (${raw.id}): bad type "${raw.type}"`);
  if (typeof raw.date !== 'string' || !DATE_RE.test(raw.date)) {
    throw new Error(`event[${i}] (${raw.id}): bad date "${raw.date}" (want YYYY-MM-DD)`);
  }
  if (typeof raw.title !== 'string' || !raw.title) throw new Error(`event[${i}] (${raw.id}): missing title`);
  if (!IMPORTANCES.has(importance)) throw new Error(`event[${i}] (${raw.id}): bad importance "${raw.importance}"`);

  const holders = raw.holders == null ? null : asStringArray(raw.holders);

  return {
    id: raw.id,
    event_type: type as 'macro' | 'earnings',
    event_date: raw.date,
    event_time: typeof raw.time === 'string' && raw.time ? raw.time : null,
    title: raw.title,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    importance: importance as 'high' | 'medium' | 'low',
    tickers: asStringArray(raw.tickers),
    holders,
    holder_count: typeof raw.holder_count === 'number' ? raw.holder_count : holders?.length ?? 0,
    source: parseSource(raw.source),
    position: i,
  };
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

  const rows = (parsed as RawEvent[]).map(toRow);
  await replaceUpcomingEvents(rows);

  const macro = rows.filter((r) => r.event_type === 'macro').length;
  const earnings = rows.length - macro;
  console.log(`saved: ${rows.length} events (${macro} macro, ${earnings} earnings) from ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
