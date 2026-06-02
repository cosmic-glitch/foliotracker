import type { Timeframe } from '../lib/timeframe';

interface TimeframeToggleProps {
  timeframe: Timeframe;
  onChange: (next: Timeframe) => void;
  ariaLabel?: string;
}

// 1D / 30D pill — mirrors the styling used in the landing page's Users header
// (see LandingPage.tsx) so the control reads as the same affordance across
// surfaces. Keep them in sync if either side changes.
export function TimeframeToggle({
  timeframe,
  onChange,
  ariaLabel = 'Timeframe',
}: TimeframeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center bg-background rounded-lg p-0.5 border border-border text-xs shrink-0"
    >
      <button
        role="tab"
        aria-selected={timeframe === 'day'}
        onClick={() => onChange('day')}
        className={`px-2.5 py-1 rounded-md transition-colors ${
          timeframe === 'day'
            ? 'bg-card-hover text-text-primary'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        1D
      </button>
      <button
        role="tab"
        aria-selected={timeframe === '30d'}
        onClick={() => onChange('30d')}
        className={`px-2.5 py-1 rounded-md transition-colors ${
          timeframe === '30d'
            ? 'bg-card-hover text-text-primary'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        30D
      </button>
    </div>
  );
}
