import { Activity } from 'lucide-react';
import type { MarketPulse as Pulse } from '../hooks/useMarketPulse';

// "1:30 PM ET" today, "Wed 4:30 PM ET" on an earlier day — the pulse only
// regenerates in market hours, so evenings and weekends show the last close.
function formatPulseTime(iso: string): string {
  const d = new Date(iso);
  const dayKey = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const time = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (dayKey(d) === dayKey(new Date())) return `${time} ET`;
  const weekday = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  return `${weekday} ${time} ET`;
}

// Landing-page market snapshot: a headline + 2–3 sentences, written by
// scripts/generate-pulse.sh. Same notepad-tab shell as the movers/upcoming
// strips below it (shared w-36 tab width). Renders nothing until there's a
// pulse — including for visitors outside the preview gate (api/events.ts).
export function MarketPulse({ pulse }: { pulse: Pulse | null | undefined }) {
  if (!pulse) return null;

  return (
    <div className="mb-3 md:mb-6" aria-label="Market pulse">
      <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
        <Activity className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
        <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
          Pulse
        </span>
      </div>
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm md:text-[15px] font-semibold text-text-primary">{pulse.headline}</h2>
          <span className="shrink-0 text-xs text-text-secondary tabular-nums">
            {formatPulseTime(pulse.generatedAt)}
          </span>
        </div>
        <p className="mt-1 text-sm md:text-[15px] leading-snug text-text-secondary">{pulse.body}</p>
      </div>
    </div>
  );
}
