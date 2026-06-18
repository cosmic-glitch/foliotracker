import { Fragment, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useUpcomingEvents } from '../hooks/useUpcomingEvents';
import { formatEventDate } from '../utils/formatters';

// How many events the strip shows collapsed (one per row). Kept deliberately
// tight at 1 so the landing page leads with just the single most imminent event
// and stays uncluttered; the rest hide behind the "N more" toggle. The
// generator emits events.json already ranked (date → importance → breadth), so
// the first row is the most imminent/important.
const DISPLAY_COUNT = 1;

// Category emoji shown before each event title. Derived here in the component
// (not stored) so the persisted feed stays presentation-free; the generator's
// controlled vocabulary (see scripts/events-prompt.md) makes keyword matching on
// the title reliable. Earnings are typed; macro is matched by the report it names.
// Decorative only — aria-hidden in the render, since the title text carries the
// meaning. Order matters: more specific report keywords are checked first.
function eventEmoji(e: { type: string; title: string }): string {
  if (e.type === 'earnings') return '💰';
  const t = e.title.toLowerCase();
  // Inflation before Fed: titles like "Fed's preferred inflation gauge (PCE)"
  // contain "fed" but are inflation prints, so they must match 📈 first; only an
  // actual rate decision falls through to 🏦.
  if (t.includes('inflation') || t.includes('pce') || t.includes('cpi') || t.includes('ppi')) return '📈';
  if (t.includes('fomc') || t.includes('rate decision') || t.includes('fed')) return '🏦';
  if (t.includes('payroll') || t.includes('jobs') || t.includes('employment') || t.includes('jolts') || t.includes('job opening')) return '💼';
  if (t.includes('gdp') || t.includes('growth')) return '📊';
  if (t.includes('retail')) return '🛍️';
  if (t.includes('manufactur') || t.includes('ism') || t.includes('pmi')) return '🏭';
  if (t.includes('sentiment') || t.includes('confidence')) return '🧭';
  return '📅';
}

// "Upcoming" strip directly below MoversStrip on the landing page. Same shell
// and the same notepad-tab-with-label + inline expand link (a blue "N more" at
// the bottom-right of the last row) pattern as the movers strip, so the two read
// as a matched pair: what moved / what's coming. A
// folder tab (calendar + "Upcoming") juts from the card's top-left; rows fill
// the full width below. One event per row, rendered as a plain statement:
// date | title. Near-term events (≤ 3 days out) show a relative label ("Today" /
// "Tomorrow" / "In N days") in place of the absolute date; further-out events
// keep the "Jun 24" form (see formatEventDate in utils/formatters). All dates
// share one color — deliberately NOT the accent blue, which on this page reads
// as a link (the "N more"/"less" toggle is blue).
//
// Spare by design: no color-coded impact dot and no ticker chip. The strip shows
// the next events across all importance levels (high/medium/low macro + every
// held earnings), ranked chronologically — so it answers "what's coming next?"
// rather than "what's most severe?", and an importance dot would just add noise
// to a plain date | title statement. Earnings titles are already self-contained
// ("Micron Q3 FY26 earnings"), so a separate ticker chip was redundant too; the
// title alone reads cleanly.
//
// Each title is prefixed with a single category emoji (eventEmoji above) — 🏦
// Fed/rates, 📈 inflation, 💼 jobs, 📊 growth, 🛍️ retail, 🏭 manufacturing, 💰
// earnings. It's a lightweight at-a-glance cue for the kind of event, derived
// from the event (not stored), and is purely decorative (aria-hidden) — it cues
// category, not severity (which the strip deliberately doesn't encode).
//
// No right-column meta either: the clock time and holder handles are both
// deliberately omitted. On a narrow (mobile) layout the screen is too cramped
// for them, and — because this is a CSS grid — a meta column would reserve its
// widest cell's width across every row, starving the title column and forcing
// truncation even on rows whose own meta is empty. Dropping the column gives the
// title all the space.
//
// Renders nothing when there are no future events (an empty strip would just be
// filler) or on error — it never shows a broken card. While the first load is
// still in flight it holds its space with a skeleton instead, so it doesn't pop
// in above the Users card and shove it down once the feed arrives.
export function UpcomingEvents() {
  const { data, isLoading } = useUpcomingEvents();
  const [expanded, setExpanded] = useState(false);

  // Show the next events across all importance levels — no client-side filter.
  // The feed arrives pre-ranked (date → importance → breadth, stored in
  // `position`), so slicing the first DISPLAY_COUNT yields the most imminent
  // events, with importance only breaking ties within a given date. The rest sit
  // behind the "more" toggle.
  const events = data?.events ?? [];
  const canExpand = events.length > DISPLAY_COUNT;
  const shown = expanded && canExpand ? events : events.slice(0, DISPLAY_COUNT);

  // Folder tab jutting from the card's top-left — calendar + label, no bottom
  // border, z-10 so it paints over the card body's top border into one connected
  // notepad-tab shape. Matches the movers strip's tab, including the shared fixed
  // width (w-36) that keeps all three landing-page tabs at a constant width.
  // Shared by the real strip and the loading skeleton below.
  const tab = (
    <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
      <CalendarDays className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
      <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
        Upcoming
      </span>
    </div>
  );

  // No events to show: render nothing once the feed has settled empty, but hold
  // the strip's space with a skeleton while the first load is in flight so it
  // doesn't pop in above the Users card and shove it down once the feed arrives.
  // (isLoading is React Query's first-load flag — false on refetch/error, so an
  // empty or errored feed still renders nothing rather than a stuck skeleton.)
  if (shown.length === 0) {
    if (!isLoading) return null;
    return (
      <div className="mb-3 md:mb-6" aria-hidden>
        {tab}
        <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 animate-pulse">
            {Array.from({ length: DISPLAY_COUNT }).map((_, i) => (
              <Fragment key={i}>
                <div className="h-3.5 w-16 rounded bg-card-hover" />
                <div className="h-3.5 w-40 rounded bg-card-hover" />
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-3 md:mb-6"
      aria-label="Upcoming market events"
    >
      {tab}

      {/* Card body: top-left squared to line up flush under the tab, pulled up
          1px to overlap the tab's missing bottom border. */}
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        {/* date | title — date sizes to content, title takes the rest on a
            single line. Titles are kept short by the generator (≤ 32 chars; see
            events-prompt.md) so they fit one line in this narrow mobile column
            without wrapping. `truncate` is just a backstop for an over-long title
            that slips through — it clips with an ellipsis rather than wrapping to
            a second line (a two-line row was rejected: it makes the strip ragged
            and breaks the matched-pair look with the movers strip above). Both
            event types render the same: a plain title statement, no leading
            impact dot or ticker chip (see the component header). */}
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
          {shown.map((e, i) => {
            const isLast = i === shown.length - 1;
            // Imminent events (≤ 3 days out) show a relative label ("Today",
            // "Tomorrow", "In 2 days"); further-out events show the absolute
            // date ("Jun 24"). All dates render in the same color — accent blue
            // was rejected because it reads as a link next to the genuinely-blue
            // "more"/"less" toggle.
            const dateLabel = formatEventDate(e.date);
            const title = (
              <>
                <span className="mr-1.5" aria-hidden>
                  {eventEmoji(e)}
                </span>
                {e.title}
              </>
            );
            return (
              <Fragment key={e.id}>
                <span className="font-semibold text-text-primary text-sm md:text-[15px] whitespace-nowrap tabular-nums">
                  {dateLabel}
                </span>
                {isLast && canExpand ? (
                  // Last row shares its track with the expand/collapse link at
                  // the bottom-right (no separate toggle line); the title
                  // truncates a little earlier to make room for the blue link.
                  <span className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="truncate min-w-0 text-sm md:text-[15px] text-text-primary">
                      {title}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpanded((x) => !x)}
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? 'Show fewer events'
                          : `Show all ${events.length} events`
                      }
                      className="shrink-0 text-xs font-medium text-accent hover:underline whitespace-nowrap tabular-nums"
                    >
                      {expanded
                        ? 'less'
                        : `${events.length - DISPLAY_COUNT} more`}
                    </button>
                  </span>
                ) : (
                  <span className="truncate min-w-0 text-sm md:text-[15px] text-text-primary">
                    {title}
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>

      </div>
    </div>
  );
}
