import { useState, useMemo } from 'react';
import { Clock, Filter } from 'lucide-react';
import type { HoldingsHistoryEntry } from '../hooks/useHoldingsHistory';
import { formatCurrency } from '../utils/formatters';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function changeLabel(entry: HoldingsHistoryEntry): string {
  if (entry.change_type === 'added') return 'Added';
  if (entry.change_type === 'removed') return 'Removed';
  return 'Updated';
}

function changeBadgeColor(type: HoldingsHistoryEntry['change_type']): string {
  if (type === 'added') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (type === 'removed') return 'bg-red-500/15 text-red-400 border-red-500/30';
  return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
}

function sharesDelta(entry: HoldingsHistoryEntry): string | null {
  if (entry.change_type === 'added') return `+${entry.shares}`;
  if (entry.change_type === 'removed') return entry.prev_shares != null ? `−${entry.prev_shares}` : null;
  if (entry.prev_shares == null) return null;
  const delta = entry.shares - entry.prev_shares;
  if (delta === 0) return null;
  return delta > 0 ? `+${delta}` : `${delta}`;
}

interface Props {
  history: HoldingsHistoryEntry[];
  isLoading?: boolean;
}

export function HoldingsHistory({ history, isLoading }: Props) {
  const [tickerFilter, setTickerFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const tickers = useMemo(() => {
    const s = new Set(history.map((h) => h.ticker));
    return Array.from(s).sort();
  }, [history]);

  const filtered = useMemo(() => {
    return history.filter((h) => {
      if (tickerFilter !== 'all' && h.ticker !== tickerFilter) return false;
      if (typeFilter !== 'all' && h.change_type !== typeFilter) return false;
      return true;
    });
  }, [history, tickerFilter, typeFilter]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <Clock className="w-8 h-8 mx-auto mb-2 text-text-tertiary" />
        <p className="text-sm font-medium text-text-primary">No holdings changes yet</p>
        <p className="text-xs text-text-tertiary mt-1">
          Edits to shares or static values will appear here as an append-only log. History starts when this feature is deployed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" />
          Holdings History
          <span className="text-xs font-normal text-text-tertiary">({filtered.length} of {history.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            <Filter className="w-3 h-3" />
          </div>
          <select
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1 text-text-primary"
            aria-label="Filter by ticker"
          >
            <option value="all">All tickers</option>
            {tickers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1 text-text-primary"
            aria-label="Filter by change type"
          >
            <option value="all">All changes</option>
            <option value="added">Added</option>
            <option value="updated">Updated</option>
            <option value="removed">Removed</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-tertiary bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-4 py-2 font-medium">Ticker</th>
              <th className="text-left px-4 py-2 font-medium">Change</th>
              <th className="text-right px-4 py-2 font-medium">Shares</th>
              <th className="text-right px-4 py-2 font-medium">Value / Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((entry) => (
              <tr key={entry.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-text-tertiary">{formatDate(entry.recorded_at)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-text-primary">{entry.ticker}</span>
                  <span className="ml-1.5 text-xs text-text-tertiary hidden sm:inline">{entry.name}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${changeBadgeColor(entry.change_type)}`}>
                    {changeLabel(entry)}
                  </span>
                  {sharesDelta(entry) && (
                    <span className="ml-2 text-xs font-mono text-text-secondary">{sharesDelta(entry)} shares</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {entry.is_static ? (
                    <span className="text-text-tertiary">static</span>
                  ) : entry.change_type === 'removed' ? (
                    <span className="text-text-tertiary">{entry.prev_shares} → 0</span>
                  ) : entry.prev_shares == null ? (
                    <span className="text-text-primary">{entry.shares}</span>
                  ) : (
                    <span className={entry.shares !== entry.prev_shares ? 'text-amber-400' : 'text-text-primary'}>
                      {entry.prev_shares} → {entry.shares}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-xs">
                  {entry.is_static && entry.static_value != null ? (
                    <span className="font-mono text-text-primary">{formatCurrency(entry.static_value)}</span>
                  ) : entry.cost_basis != null ? (
                    <span className="font-mono text-text-tertiary">cost {formatCurrency(entry.cost_basis)}</span>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && history.length > 0 && (
          <div className="px-4 py-6 text-center text-sm text-text-tertiary">No entries match the selected filters.</div>
        )}
      </div>
      <div className="px-4 py-2 bg-muted/20 border-t border-border text-[11px] text-text-tertiary">
        Append-only log — previous values are preserved even after a ticker is removed. Share counts show previous → current.
      </div>
    </div>
  );
}
