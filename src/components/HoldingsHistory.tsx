import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Clock, Pencil, Plus, X } from 'lucide-react';
import type { HoldingsHistoryEntry } from '../hooks/useHoldingsHistory';
import { formatCurrency } from '../utils/formatters';

// One save writes all its rows in a single insert (shared timestamp), but we
// chain entries within a 60s gap so quick back-to-back edits read as one session.
const SESSION_GAP_MS = 60_000;

type Kind = 'new' | 'buy' | 'trim' | 'exit' | 'value' | 'details';

function entryKind(e: HoldingsHistoryEntry): Kind {
  if (e.change_type === 'added') return 'new';
  if (e.change_type === 'removed') return 'exit';
  if (e.is_static) return 'value';
  if (e.prev_shares != null && e.shares > e.prev_shares) return 'buy';
  if (e.prev_shares != null && e.shares < e.prev_shares) return 'trim';
  return 'details';
}

function fmtShares(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtPct(delta: number, prev: number): string {
  const pct = Math.abs((delta / prev) * 100);
  const sign = delta > 0 ? '+' : '−';
  if (pct < 0.95) return `${sign}<1%`;
  return `${sign}${Math.round(pct)}%`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

interface Session {
  entries: HoldingsHistoryEntry[];
}

function groupSessions(history: HoldingsHistoryEntry[]): Session[] {
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

function tickerList(tickers: string[]): string {
  const shown = tickers.slice(0, 3).join(', ');
  return tickers.length > 3 ? `${shown} +${tickers.length - 3} more` : shown;
}

function sessionSummary(entries: HoldingsHistoryEntry[]): string | null {
  if (entries.length < 2) return null;
  const outs: string[] = [];
  const ins: string[] = [];
  let allOutsAreExits = true;
  for (const e of entries) {
    const kind = entryKind(e);
    if (kind === 'exit' || kind === 'trim') {
      outs.push(e.ticker);
      if (kind === 'trim') allOutsAreExits = false;
    } else if (kind === 'new' || kind === 'buy') {
      ins.push(e.ticker);
    }
  }
  if (outs.length && ins.length) return `Out of ${tickerList(outs)}, into ${tickerList(ins)}`;
  if (ins.length) return `Added ${tickerList(ins)}`;
  if (outs.length) return `${allOutsAreExits ? 'Sold' : 'Reduced'} ${tickerList(outs)}`;
  return `${entries.length} changes`;
}

const KIND_ICON: Record<Kind, { Icon: typeof Plus; className: string }> = {
  new: { Icon: Plus, className: 'text-positive' },
  buy: { Icon: ArrowUp, className: 'text-positive' },
  trim: { Icon: ArrowDown, className: 'text-negative' },
  exit: { Icon: X, className: 'text-negative' },
  value: { Icon: Pencil, className: 'text-text-secondary/70' },
  details: { Icon: Pencil, className: 'text-text-secondary/70' },
};

function EntryRow({ entry }: { entry: HoldingsHistoryEntry }) {
  const kind = entryKind(entry);
  const { Icon, className } = KIND_ICON[kind];
  const delta = entry.prev_shares != null ? entry.shares - entry.prev_shares : null;

  let verb: string;
  let magnitude: React.ReactNode = null;

  switch (kind) {
    case 'new':
      verb = entry.is_static ? 'New holding' : 'New position';
      magnitude = entry.is_static
        ? entry.static_value != null && formatCurrency(entry.static_value)
        : `${fmtShares(entry.shares)} sh`;
      break;
    case 'exit':
      verb = entry.is_static ? 'Removed' : 'Sold entire position';
      magnitude = entry.is_static
        ? entry.static_value != null && `was ${formatCurrency(entry.static_value)}`
        : entry.prev_shares != null && `was ${fmtShares(entry.prev_shares)} sh`;
      break;
    case 'buy':
    case 'trim':
      verb = `${kind === 'buy' ? 'Bought' : 'Trimmed'} ${fmtShares(Math.abs(delta!))} shares`;
      magnitude = (
        <>
          {entry.prev_shares! > 0 && (
            <span className={kind === 'buy' ? 'text-positive' : 'text-negative'}>
              {fmtPct(delta!, entry.prev_shares!)}
            </span>
          )}
          <span className="hidden sm:inline text-text-secondary/70">
            {' '}· {fmtShares(entry.prev_shares!)} → {fmtShares(entry.shares)}
          </span>
        </>
      );
      break;
    case 'value':
      verb = 'Value updated';
      magnitude = entry.static_value != null && formatCurrency(entry.static_value);
      break;
    default:
      verb = 'Details updated';
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
      <span className="w-14 shrink-0 text-sm font-medium text-text-primary">{entry.ticker}</span>
      <span className="flex-1 truncate text-sm text-text-secondary">{verb}</span>
      {magnitude && <span className="shrink-0 font-mono text-xs text-text-secondary">{magnitude}</span>}
    </div>
  );
}

interface Props {
  history: HoldingsHistoryEntry[];
  isLoading?: boolean;
}

export function HoldingsHistory({ history, isLoading }: Props) {
  const sessions = useMemo(() => groupSessions(history), [history]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-card-hover rounded w-1/3" />
          <div className="h-3 bg-card-hover rounded w-full" />
          <div className="h-3 bg-card-hover rounded w-5/6" />
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <Clock className="w-8 h-8 mx-auto mb-2 text-text-secondary/70" />
        <p className="text-sm font-medium text-text-primary">No holdings changes yet</p>
        <p className="text-xs text-text-secondary/70 mt-1">
          Buys, sells, and other edits will appear here. Changes are tracked from when this feature launched.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border/50">
      {sessions.map((session) => {
        const summary = sessionSummary(session.entries);
        return (
          <div key={session.entries[0].id} className="px-4 py-3">
            <div className="mb-1 text-xs text-text-secondary/70">
              <span className="font-medium text-text-secondary">{formatDay(session.entries[0].recorded_at)}</span>
              {summary && <span> · {summary}</span>}
            </div>
            {session.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
