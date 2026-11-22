import type { MarketStatus } from '../types/portfolio';

// Outside the regular session the landing page defaults to extended-hours
// figures; this two-way switch flips it (movers strip, Users rows, ranking) to
// how the day closed. Hidden during the session, when the figures already use
// the live regular price. Before the open the extended side is pre-market; any
// other time (evening, overnight, weekend) it's the last after-hours session.
// Lives on the topmost card it affects: the movers tab row, or the Users tab
// row when the movers strip is hidden (quiet day).
export function SessionSwitch({
  marketStatus,
  atClose,
  onChange,
}: {
  marketStatus: MarketStatus;
  atClose: boolean;
  onChange: (atClose: boolean) => void;
}) {
  if (marketStatus === 'open') return null;
  const options: { label: string; close: boolean }[] = [
    { label: 'At Close', close: true },
    { label: marketStatus === 'pre-market' ? 'Pre-Market' : 'After Hours', close: false },
  ];
  return (
    <div role="group" aria-label="Price basis" className="mb-1.5 flex rounded-full border border-border bg-card p-0.5">
      {options.map((o) => {
        const active = atClose === o.close;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.close)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap transition-colors ${
              active ? 'bg-card-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
