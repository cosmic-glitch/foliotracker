import { useEffect, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useOlderPulse,
  usePrefetchOlderPulse,
  type PulsePage,
} from '../hooks/useMarketPulse';

// Viewer-local time: "10:30 AM" today, "Wed 1:30 PM" within the past week,
// "Oct 3 1:30 PM" before that (a bare weekday would be ambiguous once you've
// paged back more than a week). The pulse only regenerates in market hours,
// so evenings and weekends show the last close.
function formatPulseTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time;
  const day =
    now.getTime() - d.getTime() < 6 * 24 * 60 * 60 * 1000
      ? d.toLocaleDateString('en-US', { weekday: 'short' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

// Landing-page market snapshot: a headline + 2–3 sentences, written by
// scripts/generate-pulse.sh. Same notepad-tab shell as the movers strip above
// and the upcoming strip below it (shared w-36 tab width). Renders nothing until there's a
// pulse.
//
// ‹ › page back through history one pulse at a time (pulses build on each
// other, so reading them in order is the natural path). `trail` is the stack of
// `before` cursors: empty = the latest pulse, otherwise we show the pulse just
// older than its last entry. While browsing, the 5-minute refetch of the latest
// doesn't move you; "Latest" gains a dot when a newer pulse has landed. Not
// persisted — a reload starts at the latest.
export function MarketPulse({ latest }: { latest: PulsePage | undefined }) {
  const [trail, setTrail] = useState<string[]>([]);
  const browsing = trail.length > 0;
  const older = useOlderPulse(browsing ? trail[trail.length - 1] : null);
  const prefetchOlder = usePrefetchOlderPulse();

  // Until the first older page arrives, keep the latest on screen.
  const page = browsing && older.data?.pulse ? older.data : latest;
  const pulse = page?.pulse;
  const pending = browsing && (older.isPlaceholderData || !older.data);

  const shownAt = pulse?.generatedAt;
  const hasOlder = page?.hasOlder ?? false;
  useEffect(() => {
    if (shownAt && hasOlder) void prefetchOlder(shownAt);
  }, [shownAt, hasOlder, prefetchOlder]);

  if (!pulse) return null;

  const newerArrived = browsing && latest?.pulse?.generatedAt !== trail[0];
  const navButton =
    'p-1 rounded-md text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className="mb-3 md:mb-6" aria-label="Market pulse">
      <div className="flex items-center gap-2">
        <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
          <Activity className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
          <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
            Pulse
          </span>
        </div>
        {browsing && (
          <button
            type="button"
            onClick={() => setTrail([])}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline whitespace-nowrap"
          >
            {newerArrived && <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />}
            Latest
          </button>
        )}
        {/* Nav lives in the tab row, not the card, so the buttons stay put
            while pulses of different lengths resize the card below. */}
        {(hasOlder || browsing) && (
          <div className="ml-auto flex items-center">
            <button
              type="button"
              onClick={() => setTrail((t) => [...t, pulse.generatedAt])}
              disabled={!hasOlder || pending}
              aria-label="Older pulse"
              className={navButton}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTrail((t) => t.slice(0, -1))}
              disabled={!browsing || pending}
              aria-label="Newer pulse"
              className={navButton}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        <h2 className="text-sm md:text-[15px] font-semibold text-text-primary">{pulse.headline}</h2>
        {/* Timestamp floats right at the end of the body: it shares the last
            line when there's room, and only drops to its own line when not.
            flow-root contains the float so the card's padding wraps it. While
            browsing, desktop reserves three body lines so most steps don't
            shift the strips below; the latest view keeps its natural height. */}
        <p
          className={`flow-root mt-1 text-sm md:text-[15px] leading-snug text-text-secondary ${
            browsing ? 'md:min-h-[4.125em]' : ''
          }`}
        >
          {pulse.body}
          <span className="float-right ml-3 mt-0.5 md:mt-1 text-xs tabular-nums whitespace-nowrap">
            {formatPulseTime(pulse.generatedAt)}
          </span>
        </p>
      </div>
    </div>
  );
}
