#!/usr/bin/env npx tsx
/**
 * Backfill portfolio_daily_values (Portfolio History) for days before the
 * snapshot cron started recording them.
 *
 * Holdings for a past trading day D come from "anchors" — exact holdings
 * states: each pg_dump backup passed on the command line, plus the live
 * holdings table (now). For D, take the first anchor at/after D's close and
 * undo the holdings_history edits logged in between:
 *   - D on/after LOG_START (holdings_history went live) → 'reconstructed'
 *   - D before LOG_START: the log can't bridge, so the anchor's state is
 *     carried back — 'estimated' — at most CARRY_BACK_DAYS before the point
 *     where that state is known, or across any stretch whose bracketing
 *     anchors agree. Anything else stays a gap (no row).
 * An anchor's time is its dump's newest snapshot write — the refresh cron
 * writes every few minutes, so that is within minutes of the dump.
 *
 * Prices are fresh Yahoo daily closes, which are split-adjusted, so anchor
 * shares are scaled onto today's share basis by the splits after the anchor
 * (VGT 8:1 and VUG 6:1 split between the April and September backups).
 *
 * Never overwrites a 'recorded' row. Dry run by default.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/backfill-daily-values.ts backups/2026-03-20 ... [--write]
 *   (each arg: a backup dir containing data.sql from scripts/backup-db.sh)
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { isTradingDate, getRegularCloseTime, getDailyValueRecordDate } from '../api/_lib/cache.js';

// holdings_history shipped 2026-08-06 (commit "Add holdings history
// tracking"); edits before then were never logged.
const LOG_START = new Date('2026-08-06T04:00:00Z');
const CARRY_BACK_DAYS = 30;
const PRICE_HISTORY_START = '2026-01-01';
const DAY_MS = 86_400_000;

interface StateHolding {
  ticker: string;
  name: string;
  shares: number;
  isStatic: boolean;
  staticValue: number | null;
  instrumentType: string;
}
type State = Map<string, StateHolding>; // ticker → holding

interface Anchor {
  label: string;
  time: Date;
  states: Map<string, State>; // portfolio → state
  snapshotTotals: Map<string, number>; // portfolio → snapshot total_value (validation)
}

interface HistoryEvent {
  portfolio_id: string;
  ticker: string;
  name: string;
  shares: number;
  prev_shares: number | null;
  is_static: boolean;
  static_value: number | null;
  prev_static_value: number | null;
  instrument_type: string | null;
  change_type: 'added' | 'updated' | 'removed';
  recorded_at: Date;
}

// ── pg_dump parsing ────────────────────────────────────────────────────────
function parseCopySections(file: string, tables: string[]): Map<string, Record<string, string | null>[]> {
  const out = new Map<string, Record<string, string | null>[]>();
  let current: string | null = null;
  let cols: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (current === null) {
      const m = line.match(/^COPY public\.(\w+) \((.*)\) FROM stdin;$/);
      if (m && tables.includes(m[1])) {
        current = m[1];
        cols = m[2].split(',').map((c) => c.trim());
        out.set(current, []);
      }
      continue;
    }
    if (line === '\\.') {
      current = null;
      continue;
    }
    const vals = line.split('\t');
    const row: Record<string, string | null> = {};
    cols.forEach((c, i) => { row[c] = vals[i] === '\\N' ? null : vals[i]; });
    out.get(current)!.push(row);
  }
  return out;
}

function toStates(rows: Array<Record<string, unknown>>): Map<string, State> {
  const states = new Map<string, State>();
  for (const r of rows) {
    const pid = String(r.portfolio_id);
    if (!states.has(pid)) states.set(pid, new Map());
    const isStatic = r.is_static === true || r.is_static === 't';
    states.get(pid)!.set(String(r.ticker), {
      ticker: String(r.ticker),
      name: String(r.name),
      shares: Number(r.shares),
      isStatic,
      staticValue: r.static_value == null ? null : Number(r.static_value),
      instrumentType: (r.instrument_type as string | null) || 'Other',
    });
  }
  return states;
}

function loadDumpAnchor(dir: string): Anchor | null {
  const file = path.join(dir, 'data.sql');
  if (!existsSync(file) || statSync(file).size === 0) {
    console.warn(`skip ${dir}: no data.sql`);
    return null;
  }
  const sections = parseCopySections(file, ['holdings', 'portfolio_snapshots']);
  const snapshots = sections.get('portfolio_snapshots') ?? [];
  const time = new Date(Math.max(...snapshots.map((s) => new Date(s.updated_at!).getTime())));
  return {
    label: path.basename(path.resolve(dir)),
    time,
    states: toStates(sections.get('holdings') ?? []),
    snapshotTotals: new Map(snapshots.map((s) => [s.portfolio_id!, Number(s.total_value)])),
  };
}

// ── State helpers ──────────────────────────────────────────────────────────
function cloneState(s: State | undefined): State {
  return new Map([...(s ?? new Map()).entries()].map(([k, v]) => [k, { ...v }]));
}

// Undo the logged edits in (from, to] — newest first — to roll `state` (exact
// at `to`) back to `from`.
function rollBack(state: State, events: HistoryEvent[], from: Date, to: Date): State {
  const s = cloneState(state);
  for (const e of events) {
    if (e.recorded_at <= from || e.recorded_at > to) continue;
    if (e.change_type === 'added') {
      s.delete(e.ticker);
    } else {
      s.set(e.ticker, {
        ticker: e.ticker,
        name: e.name,
        shares: Number(e.prev_shares ?? 0),
        isStatic: e.is_static,
        staticValue: e.prev_static_value ?? e.static_value,
        instrumentType: e.instrument_type || 'Other',
      });
    }
  }
  return s;
}

function stateKey(s: State): string {
  return JSON.stringify(
    [...s.values()]
      .map((h) => [h.ticker, Number(h.shares.toFixed(4)), h.isStatic, h.staticValue])
      .sort(),
  );
}

// ── Yahoo prices + splits ──────────────────────────────────────────────────
interface PriceSeries {
  closes: Map<string, number>; // ET date → split-adjusted close
  dates: string[]; // sorted
  splits: Array<{ date: Date; ratio: number }>;
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

async function fetchSeries(ticker: string): Promise<PriceSeries | null> {
  const p1 = Math.floor(new Date(`${PRICE_HISTORY_START}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&events=split`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r?.timestamp) return null;
  const closes = new Map<string, number>();
  const raw: Array<number | null> = r.indicators?.quote?.[0]?.close ?? [];
  r.timestamp.forEach((ts: number, i: number) => {
    const c = raw[i];
    if (c != null && c > 0) closes.set(ET_DATE.format(new Date(ts * 1000)), c);
  });
  const splits = Object.values((r.events?.splits ?? {}) as Record<string, { date: number; numerator: number; denominator: number }>)
    .map((s) => ({ date: new Date(s.date * 1000), ratio: s.numerator / s.denominator }));
  return { closes, dates: [...closes.keys()].sort(), splits };
}

// Close on `date`, or the latest one before it (funds/holiday mismatches).
function closeOn(series: PriceSeries, date: string): number | null {
  const direct = series.closes.get(date);
  if (direct != null) return direct;
  let best: string | null = null;
  for (const d of series.dates) {
    if (d > date) break;
    best = d;
  }
  return best ? series.closes.get(best)! : null;
}

// Product of split ratios strictly after `t`.
function splitFactorAfter(series: PriceSeries, t: Date): number {
  return series.splits.filter((s) => s.date > t).reduce((f, s) => f * s.ratio, 1);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const write = process.argv.includes('--write');
  const dumpDirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL must be set (set -a; source .env.local; set +a)');

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const now = new Date();
    const anchors = dumpDirs.map(loadDumpAnchor).filter((a): a is Anchor => a !== null);
    const live = await client.query('SELECT * FROM holdings');
    anchors.push({ label: 'live', time: now, states: toStates(live.rows), snapshotTotals: new Map() });
    anchors.sort((a, b) => a.time.getTime() - b.time.getTime());
    console.log('anchors:', anchors.map((a) => `${a.label}@${a.time.toISOString()}`).join(', '));

    const events: HistoryEvent[] = (
      await client.query('SELECT * FROM holdings_history ORDER BY recorded_at DESC')
    ).rows.map((e) => ({
      ...e,
      shares: Number(e.shares),
      prev_shares: e.prev_shares == null ? null : Number(e.prev_shares),
      static_value: e.static_value == null ? null : Number(e.static_value),
      prev_static_value: e.prev_static_value == null ? null : Number(e.prev_static_value),
      recorded_at: new Date(e.recorded_at),
    }));

    const portfolios: Array<{ id: string; created_at: Date }> = (
      await client.query('SELECT id, created_at FROM portfolios ORDER BY id')
    ).rows;
    const recorded = new Set(
      (await client.query(`SELECT portfolio_id, date::text AS date FROM portfolio_daily_values WHERE source = 'recorded'`))
        .rows.map((r) => `${r.portfolio_id}|${r.date}`),
    );

    // Trading dates up to the last completed session.
    const lastDate = getDailyValueRecordDate(now) ?? ET_DATE.format(new Date(now.getTime() - DAY_MS));
    const dates: string[] = [];
    for (let t = new Date(`${PRICE_HISTORY_START}T12:00:00Z`); ; t = new Date(t.getTime() + DAY_MS)) {
      const d = t.toISOString().slice(0, 10);
      if (d > lastDate) break;
      if (isTradingDate(d)) dates.push(d);
    }

    // Holdings state per (portfolio, date).
    type Plan = { state: State; source: 'reconstructed' | 'estimated'; anchorTime: Date };
    const plans = new Map<string, Map<string, Plan>>();
    const tickers = new Set<string>();
    for (const p of portfolios) {
      const created = ET_DATE.format(new Date(p.created_at));
      const pEvents = events.filter((e) => e.portfolio_id === p.id);
      const perDate = new Map<string, Plan>();
      for (const d of dates) {
        if (d < created) continue;
        const close = getRegularCloseTime(d);
        const nextIdx = anchors.findIndex((a) => a.time >= close);
        const next = anchors[nextIdx];
        if (!next.states.has(p.id)) continue;
        const state = rollBack(next.states.get(p.id)!, pEvents, close, next.time);
        if (state.size === 0) continue;

        let source: Plan['source'] | null = null;
        if (close >= LOG_START) {
          source = 'reconstructed';
        } else {
          // Before the log, the rolled-back state is only known as of
          // LOG_START (or the anchor itself if that is earlier).
          const knownAt = next.time > LOG_START ? LOG_START : next.time;
          const prev = nextIdx > 0 ? anchors[nextIdx - 1] : null;
          const prevState = prev?.states.get(p.id);
          if (knownAt.getTime() - close.getTime() <= CARRY_BACK_DAYS * DAY_MS) {
            source = 'estimated';
          } else if (prevState && stateKey(prevState) === stateKey(state)) {
            source = 'estimated'; // unchanged across the whole unlogged stretch
          }
        }
        if (!source) continue;
        perDate.set(d, { state, source, anchorTime: next.time });
        for (const h of state.values()) if (!h.isStatic) tickers.add(h.ticker);
      }
      plans.set(p.id, perDate);
    }

    console.log(`fetching ${tickers.size} price series...`);
    const series = new Map<string, PriceSeries>();
    for (const t of tickers) {
      const s = await fetchSeries(t);
      if (s) series.set(t, s);
      else console.warn(`  no Yahoo history for ${t}`);
      const splits = s?.splits.filter((x) => x.date.toISOString() >= PRICE_HISTORY_START) ?? [];
      if (splits.length) console.log(`  ${t} splits: ${splits.map((x) => `${x.date.toISOString().slice(0, 10)} ×${x.ratio}`).join(', ')}`);
    }

    const rows: Array<{ portfolio_id: string; date: string; total_value: number; holdings: unknown[]; source: string }> = [];
    const missing = new Map<string, number>();
    for (const [pid, perDate] of plans) {
      for (const [d, plan] of perDate) {
        if (recorded.has(`${pid}|${d}`)) continue;
        const holdings = [];
        for (const h of plan.state.values()) {
          if (h.isStatic) {
            holdings.push({ ticker: h.ticker, name: h.name, shares: h.shares, value: h.staticValue ?? 0, isStatic: true, instrumentType: h.instrumentType });
            continue;
          }
          const s = series.get(h.ticker);
          const adjClose = s ? closeOn(s, d) : null;
          if (!s || adjClose == null) {
            missing.set(h.ticker, (missing.get(h.ticker) ?? 0) + 1);
            continue;
          }
          // Anchor shares → today's basis → shares actually held on d.
          const sharesNow = h.shares * splitFactorAfter(s, plan.anchorTime);
          const dayFactor = splitFactorAfter(s, getRegularCloseTime(d));
          holdings.push({
            ticker: h.ticker,
            name: h.name,
            shares: sharesNow / dayFactor,
            value: sharesNow * adjClose,
            isStatic: false,
            instrumentType: h.instrumentType,
          });
        }
        rows.push({
          portfolio_id: pid,
          date: d,
          total_value: holdings.reduce((sum, h) => sum + h.value, 0),
          holdings,
          source: plan.source,
        });
      }
    }
    if (missing.size) console.warn('holdings skipped for missing prices (ticker: days):', Object.fromEntries(missing));

    // Coverage summary.
    for (const p of portfolios) {
      const pr = rows.filter((r) => r.portfolio_id === p.id);
      const by = (src: string) => pr.filter((r) => r.source === src).map((r) => r.date);
      const span = (ds: string[]) => (ds.length ? `${ds[0]}→${ds[ds.length - 1]} (${ds.length}d)` : '—');
      console.log(`${p.id.padEnd(7)} reconstructed ${span(by('reconstructed')).padEnd(32)} estimated ${span(by('estimated'))}`);
    }

    // Validation: the snapshot in each dump was written after the previous
    // close, so its total should be near our value for that close (it
    // includes extended-hours prints, so expect small drift).
    console.log('\nvalidation vs dump snapshot totals (% diff):');
    for (const a of anchors) {
      if (a.snapshotTotals.size === 0) continue;
      const d = [...dates].reverse().find((x) => getRegularCloseTime(x) <= a.time);
      const diffs = [...a.snapshotTotals].map(([pid, total]) => {
        const r = rows.find((x) => x.portfolio_id === pid && x.date === d);
        return r && total ? `${pid} ${(((r.total_value - total) / total) * 100).toFixed(2)}` : `${pid} n/a`;
      });
      console.log(`  ${a.label} (close ${d}): ${diffs.join(' | ')}`);
    }

    if (!write) {
      console.log(`\nDry run: ${rows.length} rows. Re-run with --write to upsert.`);
      return;
    }
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const params: unknown[] = [];
      const values = batch.map((r, j) => {
        params.push(r.portfolio_id, r.date, r.total_value, JSON.stringify(r.holdings), r.source);
        const o = j * 5;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}::jsonb, $${o + 5})`;
      });
      await client.query(
        `INSERT INTO portfolio_daily_values (portfolio_id, date, total_value, holdings, source)
         VALUES ${values.join(', ')}
         ON CONFLICT (portfolio_id, date) DO UPDATE
           SET total_value = EXCLUDED.total_value, holdings = EXCLUDED.holdings,
               source = EXCLUDED.source, updated_at = NOW()
           WHERE portfolio_daily_values.source <> 'recorded'`,
        params,
      );
    }
    console.log(`\nWrote ${rows.length} rows.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
