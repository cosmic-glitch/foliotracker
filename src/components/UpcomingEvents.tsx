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

// "Upcoming" strip directly below MoversStrip on the landing page. Same shell
// and the same notepad-tab-with-label + centered expand toggle pattern as the
// movers strip, so the two read as a matched pair: what moved / what's coming. A
// folder tab (calendar + "Upcoming") juts from the card's top-left; rows fill
// the full width below. One event per row: date | impact dot or ticker chip +
// title.
//
// No right-column meta: the clock time and holder handles are both deliberately
// omitted. On a narrow (mobile) layout the screen is too cramped for them, and —
// because this is a CSS grid — a meta column would reserve its widest cell's
// width across every row, starving the title column and forcing truncation even
// on rows whose own meta is empty. Dropping the column gives the title all the
// space.
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
      className="mb-3 md:mb-6"
      aria-label="Upcoming market events"
    >
      {/* Folder tab jutting from the card's top-left — calendar + label, no
          bottom border, z-10 so it paints over the card body's top border into
          one connected notepad-tab shape. Matches the movers strip's tab. */}
      <div className="relative z-10 inline-flex items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
        <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
          Upcoming
        </span>
      </div>

      {/* Card body: top-left squared to line up flush under the tab, pulled up
          1px to overlap the tab's missing bottom border. */}
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        {/* date | title — date sizes to content, title flexes and truncates only
            when it genuinely runs out of room (no meta column stealing width). */}
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
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
            </Fragment>
          ))}
        </div>

        {/* Centered expand/collapse toggle below the rows — same pattern as the
            movers strip. */}
        {canExpand && (
          <div className="flex justify-center mt-2">
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
          </div>
        )}
      </div>
    </div>
  );
}
