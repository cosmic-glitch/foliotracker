import { Fragment, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import { useUpcomingEvents, type UpcomingEvent } from '../hooks/useUpcomingEvents';
import { formatChartDate } from '../utils/formatters';

// How many events the strip shows collapsed (one per row), matching the movers
// strip's DISPLAY_COUNT so the two stack as a visually consistent pair. The
// generator emits events.json already ranked (date → importance → breadth), so
// the first N rows are the most imminent/important; the rest hide behind the
// toggle.
const DISPLAY_COUNT = 3;

// Macro impact follows the economic-calendar convention (Forex Factory /
// Investing.com): red = high, amber = medium, slate = low. Earnings don't use a
// dot — they get a ticker chip instead (see below).
const IMPORTANCE_DOT: Record<UpcomingEvent['importance'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
};

// Right-column meta: the time, plus holder handles for earnings (uppercased to
// match the Users list / movers strip), e.g. "after close · AV, VD".
function metaLabel(e: UpcomingEvent): string {
  const parts: string[] = [];
  if (e.time) parts.push(e.time);
  if (e.type === 'earnings' && e.holders && e.holders.length > 0) {
    parts.push(e.holders.map((h) => h.toUpperCase()).join(', '));
  }
  return parts.join(' · ');
}

// "Upcoming" strip directly below MoversStrip on the landing page. Same shell
// (bg-card border rounded-3xl) and the same left-rail-with-label + expand toggle
// pattern as the movers strip, so the two read as a matched pair: what moved /
// what's coming. One event per row: date | impact dot or ticker chip + title |
// time/holders.
//
// Renders nothing when there are no future events (an empty strip would just be
// filler) or while the query is loading/errored — it never shows a broken card.
export function UpcomingEvents() {
  const { data } = useUpcomingEvents();
  const [expanded, setExpanded] = useState(false);

  const events = data?.events ?? [];
  const canExpand = events.length > DISPLAY_COUNT;
  const shown = expanded && canExpand ? events : events.slice(0, DISPLAY_COUNT);

  if (shown.length === 0) return null;

  return (
    <div
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2.5 flex items-start gap-3 md:gap-5"
      aria-label="Upcoming market events"
    >
      {/* Left rail: calendar above the label, with the expand/collapse toggle
          tucked underneath — same placement as the movers strip's "N more". */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <CalendarDays className="w-4 h-4 text-text-secondary" aria-hidden />
        <span className="text-[15px] md:text-base font-semibold text-text-primary whitespace-nowrap">
          Upcoming
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={
              expanded ? 'Show fewer events' : `Show all ${events.length} events`
            }
            className="flex items-center gap-0.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            {expanded ? (
              <>
                <span>less</span>
                <ChevronUp className="w-3.5 h-3.5" aria-hidden />
              </>
            ) : (
              <>
                <span className="whitespace-nowrap">
                  <span className="tabular-nums">
                    {events.length - DISPLAY_COUNT}
                  </span>{' '}
                  more
                </span>
                <ChevronDown className="w-3.5 h-3.5" aria-hidden />
              </>
            )}
          </button>
        )}
      </div>

      {/* date | title | meta — date and meta size to content, title flexes and
          truncates so a long name never pushes the time off the row. */}
      <div className="flex-1 min-w-0">
        <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1.5">
          {shown.map((e) => (
            <Fragment key={e.id}>
              <span className="font-semibold text-text-primary text-sm md:text-[15px] whitespace-nowrap tabular-nums">
                {formatChartDate(e.date)}
              </span>
              <span className="flex items-center gap-2 min-w-0 text-sm md:text-[15px] text-text-primary">
                {e.type === 'earnings' ? (
                  <span className="text-[11px] font-bold tabular-nums text-accent border border-accent/40 bg-accent/10 rounded px-1.5 py-px whitespace-nowrap">
                    {e.tickers[0] ?? '•'}
                  </span>
                ) : (
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${IMPORTANCE_DOT[e.importance]}`}
                    aria-hidden
                  />
                )}
                <span className="truncate">{e.title}</span>
              </span>
              <span className="text-xs text-text-secondary whitespace-nowrap text-right">
                {metaLabel(e)}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
