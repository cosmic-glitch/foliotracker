import { ArrowDown, ArrowUp, Clock, Pencil, Plus, X } from 'lucide-react';
import type { HoldingsHistoryEntry } from '../hooks/useHoldingsHistory';
import { formatCurrency } from '../utils/formatters';
import type { Session } from '../utils/holdingsHistory';

type Kind = 'new' | 'buy' | 'trim' | 'exit' | 'value' | 'details';

function entryKind(e: HoldingsHistoryEntry): Kind {
  if (e.change_type === 'added') return 'new';
  if (e.change_type === 'removed') return 'exit';
  if (e.is_static) return 'value';
  if (e.prev_shares != null && e.shares > e.prev_shares) return 'buy';
  if (e.prev_shares != null && e.shares < e.prev_shares) return 'trim';
  return 'details';
}

// Share counts read as "264.9 sh" — one decimal at most; fractional-share
// precision is noise next to the dollar figure.
function fmtShares(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtPct(delta: number, prev: number): string {
  const pct = Math.abs((delta / prev) * 100);
  const sign = delta > 0 ? '+' : '−';
  if (pct < 0.95) return `${sign}<1%`;
  return `${sign}${Math.round(pct)}%`;
}

// Signed, compact ($45.2k / $1.23M) dollar figure. `approx` marks amounts
// derived from the day's close rather than an actual fill — every tradeable
// figure here, since the fill price isn't logged.
function fmtDollars(value: number, approx: boolean): string {
  const sign = value < 0 ? '−' : '+';
  return `${approx ? '~' : ''}${sign}${formatCurrency(Math.abs(value), true)}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
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
  const tone = kind === 'new' || kind === 'buy' ? 'text-positive' : kind === 'trim' || kind === 'exit' ? 'text-negative' : 'text-text-secondary';

  // `verb` is the plain-language action; `amount` is the dollar figure that
  // pops in green/red; `detail` is muted desktop-only context.
  let verb: string;
  let amount: string | null = null;
  let detail: string | null = null;

  switch (kind) {
    case 'new':
      if (entry.is_static) {
        verb = 'New holding';
        if (entry.static_value != null) amount = fmtDollars(entry.static_value, false);
      } else {
        verb = `Bought ${fmtShares(entry.shares)} sh`;
        if (entry.price != null) amount = fmtDollars(entry.shares * entry.price, true);
        detail = 'new position';
      }
      break;
    case 'exit':
      if (entry.is_static) {
        verb = 'Removed';
        if (entry.static_value != null) amount = fmtDollars(-entry.static_value, false);
      } else {
        verb = `Sold ${fmtShares(entry.prev_shares ?? 0)} sh`;
        if (entry.price != null && entry.prev_shares != null) amount = fmtDollars(-entry.prev_shares * entry.price, true);
        detail = 'entire position';
      }
      break;
    case 'buy':
    case 'trim':
      verb = `${kind === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(Math.abs(delta!))} sh`;
      if (entry.price != null) amount = fmtDollars(delta! * entry.price, true);
      detail = `${entry.prev_shares! > 0 ? `${fmtPct(delta!, entry.prev_shares!)} · ` : ''}${fmtShares(entry.prev_shares!)} → ${fmtShares(entry.shares)}`;
      break;
    case 'value':
      verb = 'Value updated';
      if (entry.static_value != null) amount = formatCurrency(entry.static_value, true);
      break;
    default:
      verb = 'Details updated';
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${className}`} />
      <span className="w-14 shrink-0 text-sm font-medium text-text-primary">{entry.ticker}</span>
      <span className="flex-1 truncate text-sm text-text-secondary">
        {verb}
        {detail && <span className="hidden sm:inline text-text-secondary/70"> · {detail}</span>}
      </span>
      {amount && <span className={`shrink-0 font-mono text-xs font-medium ${tone}`}>{amount}</span>}
    </div>
  );
}

interface Props {
  // Already filtered to material changes and grouped (materialSessions in App).
  sessions: Session[];
  isLoading?: boolean;
}

export function HoldingsHistory({ sessions, isLoading }: Props) {

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

  if (sessions.length === 0) {
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
