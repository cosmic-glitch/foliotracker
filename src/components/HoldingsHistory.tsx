import { useEffect, useState } from 'react';
import { AlertCircle, Clock, Loader2, Trash2, X } from 'lucide-react';
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

// Share counts read as "264.9 shares" — one decimal at most; fractional-share
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

// Unsigned, compact ($45.2k / $1.23M) dollar figure — the row's colour
// carries direction. `approx` marks amounts derived from the day's close
// rather than an actual fill — every tradeable figure here, since the fill
// price isn't logged.
function fmtDollars(value: number, approx: boolean): string {
  return `${approx ? '~' : ''}${formatCurrency(Math.abs(value), true)}`;
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

// Rows carry no leading kind icon: the amount's green/red already says
// buy vs. sell, so the row starts at the ticker and the freed space goes to
// the owner-only delete control on the right.
function EntryRow({ entry, onDelete }: { entry: HoldingsHistoryEntry; onDelete?: (entry: HoldingsHistoryEntry) => void }) {
  const kind = entryKind(entry);
  const delta = entry.prev_shares != null ? entry.shares - entry.prev_shares : null;
  // Static value edits colour by the direction of the dollar delta, once known.
  const valueDelta =
    kind === 'value' && entry.static_value != null && entry.prev_static_value != null
      ? entry.static_value - entry.prev_static_value
      : null;
  const tone =
    kind === 'new' || kind === 'buy' || (valueDelta != null && valueDelta > 0)
      ? 'text-positive'
      : kind === 'trim' || kind === 'exit' || (valueDelta != null && valueDelta < 0)
        ? 'text-negative'
        : 'text-text-secondary';

  // `verb` is the plain-language action; `amount` is the dollar figure that
  // pops in green/red; `detail` is muted desktop-only context.
  let verb: string;
  let amount: React.ReactNode = null;
  let detail: string | null = null;

  switch (kind) {
    case 'new':
      if (entry.is_static) {
        verb = 'New holding';
        if (entry.static_value != null) amount = fmtDollars(entry.static_value, false);
      } else {
        verb = `Bought ${fmtShares(entry.shares)} shares`;
        if (entry.price != null) amount = fmtDollars(entry.shares * entry.price, true);
        detail = 'new position';
      }
      break;
    case 'exit':
      if (entry.is_static) {
        verb = 'Removed';
        if (entry.static_value != null) amount = fmtDollars(-entry.static_value, false);
      } else {
        verb = `Sold ${fmtShares(entry.prev_shares ?? 0)} shares`;
        if (entry.price != null && entry.prev_shares != null) amount = fmtDollars(-entry.prev_shares * entry.price, true);
        detail = 'entire position';
      }
      break;
    case 'buy':
    case 'trim':
      verb = `${kind === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(Math.abs(delta!))} shares`;
      if (entry.price != null) amount = fmtDollars(delta! * entry.price, true);
      detail = `${entry.prev_shares! > 0 ? `${fmtPct(delta!, entry.prev_shares!)} · ` : ''}${fmtShares(entry.prev_shares!)} → ${fmtShares(entry.shares)}`;
      break;
    case 'value':
      // Old → new, with only the new value coloured by direction.
      verb = 'Value updated';
      if (valueDelta != null) {
        amount = (
          <>
            <span className="text-text-secondary">{formatCurrency(entry.prev_static_value!, true)} → </span>
            {formatCurrency(entry.static_value!, true)}
          </>
        );
      } else if (entry.static_value != null) {
        amount = formatCurrency(entry.static_value, true);
      }
      break;
    default:
      verb = 'Details updated';
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-14 shrink-0 text-sm font-medium text-text-primary">{entry.ticker}</span>
      <span className="flex-1 truncate text-sm text-text-secondary">
        {verb}
        {detail && <span className="hidden sm:inline text-text-secondary/70"> · {detail}</span>}
      </span>
      {amount && <span className={`shrink-0 font-mono text-xs font-medium ${tone}`}>{amount}</span>}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(entry)}
          aria-label={`Delete ${entry.ticker} entry`}
          title="Delete"
          className="shrink-0 -my-1 -mr-1 p-1 rounded-md text-text-secondary/50 hover:text-negative hover:bg-card-hover transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// Owner confirmation before a row is removed. Delete is disabled while the
// request is in flight; a failure (expired session, row already gone) shows
// inline and leaves the dialog open so the user can retry or cancel.
function DeleteEntryDialog({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: HoldingsHistoryEntry;
  onConfirm: (entry: HoldingsHistoryEntry) => Promise<void>;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDeleting, onCancel]);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete entry');
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={() => !isDeleting && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-history-entry-title"
        className="bg-card rounded-2xl border border-border max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-negative/10 rounded-lg">
              <AlertCircle className="w-5 h-5 text-negative" />
            </div>
            <h3 id="delete-history-entry-title" className="text-lg font-semibold text-text-primary">
              Delete Entry
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Close"
            className="p-1 hover:bg-card-hover rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-1">
          Do you want to delete this entry from your change history?
        </p>
        <p className="text-xs text-text-secondary/70 mb-4">
          <span className="font-medium text-text-primary">{entry.ticker}</span> · {formatDay(entry.recorded_at)}. This
          only removes the log entry; your holdings are not affected.
        </p>

        {error && (
          <div className="bg-negative/10 border border-negative/20 rounded-lg px-4 py-3 text-negative text-sm mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 bg-card-hover hover:bg-border disabled:opacity-50 text-text-primary font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="flex-1 bg-negative hover:bg-negative/90 disabled:bg-negative/50 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  // Already filtered to material changes and grouped (materialSessions in App).
  sessions: Session[];
  isLoading?: boolean;
  // Owner-only: when set, each row gets a delete control. Resolves once the
  // server has removed the row (App wires this to the delete mutation).
  onDeleteEntry?: (entryId: string) => Promise<void>;
}

export function HoldingsHistory({ sessions, isLoading, onDeleteEntry }: Props) {
  const [pendingDelete, setPendingDelete] = useState<HoldingsHistoryEntry | null>(null);

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
    <>
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
                <EntryRow key={entry.id} entry={entry} onDelete={onDeleteEntry ? setPendingDelete : undefined} />
              ))}
            </div>
          );
        })}
      </div>

      {pendingDelete && onDeleteEntry && (
        <DeleteEntryDialog
          entry={pendingDelete}
          onConfirm={async (entry) => {
            await onDeleteEntry(entry.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
