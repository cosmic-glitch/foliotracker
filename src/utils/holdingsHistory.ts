import type { HoldingsHistoryEntry } from '../hooks/useHoldingsHistory';

// One save writes all its rows in a single insert (shared timestamp), but we
// chain entries within a 60s gap so quick back-to-back edits read as one session.
const SESSION_GAP_MS = 60_000;

export interface Session {
  entries: HoldingsHistoryEntry[];
}

// `history` arrives newest-first from the API.
export function groupSessions(history: HoldingsHistoryEntry[]): Session[] {
  const sessions: Session[] = [];
  let lastMs = 0;
  for (const entry of history) {
    const ms = new Date(entry.recorded_at).getTime();
    const current = sessions[sessions.length - 1];
    if (current && lastMs - ms <= SESSION_GAP_MS) {
      current.entries.push(entry);
    } else {
      sessions.push({ entries: [entry] });
    }
    lastMs = ms;
  }
  return sessions;
}

// A tradeable "updated" row whose share count didn't move was logged for a
// non-monetary edit (cost basis, or pre-Aug-2026 name/type drift). Not a
// position change — hide it.
function isBookkeepingOnly(e: HoldingsHistoryEntry): boolean {
  return e.change_type === 'updated' && !e.is_static && e.prev_shares != null && e.shares === e.prev_shares;
}

// Static holdings use the typed name as their ticker, so a rename diffs as a
// removal plus an addition at the same value. Drop both halves of each such
// pair within a session. Mirrors dropStaticRenames in api/_lib/db.ts, which
// now prevents these at write time; this handles rows logged before that.
function dropStaticRenames(entries: HoldingsHistoryEntry[]): HoldingsHistoryEntry[] {
  const removedByValue = new Map<number, HoldingsHistoryEntry[]>();
  for (const e of entries) {
    if (e.is_static && e.change_type === 'removed' && e.static_value != null) {
      const list = removedByValue.get(e.static_value) ?? [];
      list.push(e);
      removedByValue.set(e.static_value, list);
    }
  }
  if (removedByValue.size === 0) return entries;
  const drop = new Set<HoldingsHistoryEntry>();
  for (const e of entries) {
    if (e.is_static && e.change_type === 'added' && e.static_value != null) {
      const match = removedByValue.get(e.static_value)?.shift();
      if (match) {
        drop.add(match);
        drop.add(e);
      }
    }
  }
  return drop.size ? entries.filter((e) => !drop.has(e)) : entries;
}

// Rows logged before prev_static_value existed have it null. Walk oldest →
// newest and fill it from the ticker's last known static value, so legacy
// value edits still render as a delta. Rows with no earlier sighting stay null
// (the UI falls back to showing the new value).
function backfillPrevStaticValue(history: HoldingsHistoryEntry[]): HoldingsHistoryEntry[] {
  const lastValue = new Map<string, number | null>();
  const out: HoldingsHistoryEntry[] = new Array(history.length);
  for (let i = history.length - 1; i >= 0; i--) {
    let e = history[i];
    if (e.is_static) {
      if (e.prev_static_value == null && e.change_type !== 'added' && lastValue.has(e.ticker)) {
        e = { ...e, prev_static_value: lastValue.get(e.ticker) ?? null };
      }
      lastValue.set(e.ticker, e.change_type === 'removed' ? null : e.static_value);
    }
    out[i] = e;
  }
  return out;
}

// Only investment-material rows: real buys/trims/exits/adds and static value
// changes. Sessions left empty by the filter disappear entirely.
export function materialSessions(history: HoldingsHistoryEntry[]): Session[] {
  return groupSessions(backfillPrevStaticValue(history))
    .map((s) => ({ entries: dropStaticRenames(s.entries.filter((e) => !isBookkeepingOnly(e))) }))
    .filter((s) => s.entries.length > 0);
}
