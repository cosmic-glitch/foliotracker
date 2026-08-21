import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import { formatPrice } from '../utils/formatters';

// Ticker-level fundamentals carried per mover (mirrors MoverFundamentals in
// api/portfolios.ts — the two are separate build targets, keep them in sync).
// These are the same public figures the portfolio detail page's holdings popover
// shows. They remain in the contract while the strip's info affordance is
// intentionally omitted for space, so it can be restored later without an API
// migration. Any field can be null (ETFs lack revenue/earnings/P/E).
export interface MoverFundamentals {
  revenue: number | null;
  earnings: number | null;
  forwardPE: number | null;
  // Next fiscal year's forward P/E (pure projection). Optional so older
  // cached payloads (pre-field) degrade gracefully — the row just hides.
  forwardPENext?: number | null;
  operatingMargin: number | null;
  revenueGrowth3Y: number | null;
  epsGrowth3Y: number | null;
  pctTo52WeekHigh: number | null;
}

export interface MarketMover {
  ticker: string;
  // Price on the same regular/extended-hours basis as changePercent.
  price: number;
  changePercent: number;
  // Handles (portfolio ids) holding this name, in the same order the Users list
  // shows them. See the ownership note below for how they're rendered.
  holders: string[];
  // Retained for a future compact detail affordance. Optional so older cached
  // payloads (pre-fundamentals) continue to satisfy the client contract.
  fundamentals?: MoverFundamentals;
}

interface MoversStripProps {
  movers: MarketMover[];
  // First-load flag from the portfolios query. While true with no movers yet,
  // the strip holds its space with a skeleton instead of rendering nothing, so it
  // doesn't pop in above the Users card and shove it down once data lands. Once
  // loaded, an empty `movers` means a genuinely quiet day → render nothing.
  isLoading?: boolean;
}

// How many movers the pill shows by default (one per row) — the collapsed size.
// The server floors the list at the same count (MOVER_MIN_COUNT in
// api/portfolios.ts) so the rows are never short; keep the two in sync. When the
// server returns more than this, every extra name is a qualified mover (the
// backfill only ever pads UP to this floor, never past it), so a "Show all"
// toggle can safely expand the pill to the full qualified set and collapse back.
// That set is itself capped server-side at MOVER_MAX_COUNT (10), so the expanded
// pill — and the "N more" count, derived from movers.length — never exceeds it.
const DISPLAY_COUNT = 3;

// Slack (px) required beyond the measured text width before we commit to the
// names variant — covers the gap between canvas measureText and real layout
// (letter-spacing, sub-pixel rounding) so a row that "just barely" fits doesn't
// clip a character.
const FIT_SLACK_PX = 4;

// Horizontal room (px) reserved at the right end of the LAST visible row for the
// "N more" / "less" link, which lives at that row's bottom-right (sharing the
// row) rather than on its own line. Covers the widest label (a two-digit
// "NN more") plus the flex gap, so a long holder list on the last row falls back
// to the shorter count instead of running under the link. Generous by design —
// over-reserving only nudges that one row to a count.
const MORE_LINK_RESERVE_PX = 64;

// Compact ownership label for the row's flexible final column. Names are shown
// in Users-list order and separated with middle dots; when only a prefix fits,
// "+N" preserves the omitted count without spending space on "held by".
function holderLabel(m: MarketMover, visibleCount = m.holders.length): string {
  const holders = m.holders.map((h) => h.toUpperCase());
  const visible = holders.slice(0, visibleCount).join(' · ');
  const hiddenCount = holders.length - visibleCount;
  return hiddenCount > 0 ? `${visible} +${hiddenCount}` : visible;
}

// Rounded card directly above the Users card (spans its width). A folder-style
// TAB juts from the card's top-left — a flame beside the words "Top movers" —
// naming the strip and framing the per-row holders as "users here." The tab
// carries no bottom border and paints above the card body
// (z-10), so the card's top border is hidden beneath it and the two read as one
// connected shape (a notepad tab). Moving the label off the old left rail and
// onto the tab hands the rows the FULL card width. Each mover remains one row:
// ticker | price | day move | compact owner handles.
//
// Price and day move are right-aligned auto columns so their numerals line up;
// holders use the flexible final track. The ticker's old info button and the
// words "held by" are intentionally omitted to make room for price without
// increasing row height.
//
// The holder label is width-aware. Canvas measurement chooses the longest form
// that fits ("AV · GS · VD", then "AV · GS +1", and so on), independently
// per row. Measuring happens in a layout effect and on container resize.
//
// The flame is the lucide-react Flame icon — a single-color, thin-stroke line
// flame in amber (text-amber-500), monochromatic with no second shade. This is
// the original look the user preferred; it renders identically across platforms
// (unlike the native 🔥 emoji, which the platform paints in its own multi-shaded
// art). A native emoji and a two-tone SVG are both kept in git history.
//
// Expand/collapse: by default the strip shows DISPLAY_COUNT rows (the collapsed
// size). When the server returns more (every extra row is a qualified mover —
// the backfill only pads UP to the floor, never past it), a blue "N more" link
// sits at the bottom-right of the last row (sharing that row, not a separate
// toggle line) and expands the strip to the full qualified set; "less" collapses
// it back.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers). During
// the very first load (no data yet) it instead holds its space with a skeleton,
// so it doesn't pop in above the Users card and shove it down once data arrives.
export function MoversStrip({ movers, isLoading }: MoversStripProps) {
  // Collapsed by default; the viewer can expand to the full qualified list and
  // collapse back. Only offered when the server returned more than DISPLAY_COUNT
  // (i.e. there are qualified movers beyond the default rows to reveal).
  const [expanded, setExpanded] = useState(false);
  const canExpand = movers.length > DISPLAY_COUNT;
  const shown = expanded && canExpand ? movers : movers.slice(0, DISPLAY_COUNT);

  // Per-row ownership labels after fitting them to the flexible final column.
  const [holderLabels, setHolderLabels] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // One held-by cell per row; cell 0 also tells us where the holders column
  // starts (its left edge), which is the same for every row (shared grid track).
  const heldByRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const firstCell = heldByRefs.current[0];
      if (!container || !firstCell) return;

      // Holders column starts after the ticker + move columns (and their gaps);
      // the grid spans the full container from its left edge, so the cell's
      // offset from the container left is exactly that prefix width.
      const containerLeft = container.getBoundingClientRect().left;
      const columnLeft = firstCell.getBoundingClientRect().left;
      const available = container.clientWidth - (columnLeft - containerLeft);

      const canvas = (canvasRef.current ??= document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cs = getComputedStyle(firstCell);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

      const next = shown.map((m, idx) => {
        // The last visible row shares its track with the "N more" / "less" link
        // at the bottom-right; reserve its footprint so a holder list that would
        // collide with the link falls back to the shorter count instead.
        const reserve =
          canExpand && idx === shown.length - 1 ? MORE_LINK_RESERVE_PX : 0;
        const width = available - reserve;
        for (let visible = m.holders.length; visible >= 1; visible -= 1) {
          const label = holderLabel(m, visible);
          if (ctx.measureText(label).width + FIT_SLACK_PX <= width) return label;
        }
        return m.holders.length > 1 ? `+${m.holders.length}` : holderLabel(m, 1);
      });
      setHolderLabels((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next
      );
    };

    measure();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
    // shown is derived from movers + expanded; re-measure whenever either
    // changes (expanding adds rows that need their own names-vs-count fit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movers, expanded]);

  // Folder tab jutting from the card's top-left: flame + label. No bottom
  // border, and z-10 so it paints OVER the card body below — the card's top
  // border is hidden beneath the tab and the two read as one connected
  // notepad-tab shape. A FIXED width (w-36) is shared by all three landing-page
  // tabs (movers / upcoming / users) — sized to the widest label ("Top movers")
  // — so the stacked tabs line up at a constant width instead of each sizing to
  // its own label; content stays left-aligned so the tab icons align in a column
  // down the stack. The lucide Flame is a single-color thin-stroke amber flame
  // (no second shade), identical across platforms — the look the user preferred
  // over the native 🔥. Shared by the real strip and the loading skeleton below.
  const tab = (
    <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
      <Flame className="w-3.5 h-3.5 text-amber-500" aria-hidden />
      <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
        Top movers
      </span>
    </div>
  );

  // No movers to show: render nothing on a settled quiet day, but hold the
  // strip's space with a skeleton while the first load is still in flight, so it
  // doesn't pop in above the Users card and shove it down once data lands.
  // (isLoading is React Query's first-load flag — false on background refetches,
  // so a populated strip never flashes a skeleton.)
  if (shown.length === 0) {
    if (!isLoading) return null;
    return (
      <div className="mb-3 md:mb-6" aria-hidden>
        {tab}
        <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
          <div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-3 gap-y-2.5 animate-pulse">
            {Array.from({ length: DISPLAY_COUNT }).map((_, i) => (
              <Fragment key={i}>
                <div className="h-3.5 w-12 rounded bg-card-hover" />
                <div className="h-3.5 w-14 rounded bg-card-hover" />
                <div className="h-3.5 w-10 justify-self-end rounded bg-card-hover" />
                <div className="h-3 w-16 rounded bg-card-hover" />
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
      aria-label="Today's movers among tracked holdings"
    >
      {tab}

      {/* Card body. Top-left squared (rounded-tl-none) so its left border lines
          up flush beneath the tab's left border; pulled up 1px (-mt-px) to
          overlap the tab's missing bottom border into one seamless edge. Rows
          get the full width now that the label lives on the tab, not a rail. */}
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        <div ref={containerRef} className="w-full min-w-0">
          {/* ticker | price | move | owners. Price and move are stable auto
              columns; owners absorb the remaining width and compact as needed. */}
          <div className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
            {shown.map((mover, i) => {
              const isPositive = mover.changePercent >= 0;
              const isLast = i === shown.length - 1;
              const ownership = holderLabels[i] ?? holderLabel(mover, 1);
              return (
                <Fragment key={mover.ticker}>
                  <span className="font-semibold text-text-primary text-sm md:text-[15px] whitespace-nowrap">
                    {mover.ticker}
                  </span>
                  <span className="text-xs md:text-sm tabular-nums text-right text-text-primary whitespace-nowrap">
                    {formatPrice(mover.price)}
                  </span>
                  <span className={`text-sm md:text-[15px] tabular-nums text-right whitespace-nowrap ${isPositive ? 'text-positive' : 'text-negative'}`}>
                    {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
                  </span>
                  {isLast && canExpand ? (
                    // Last row shares its track with the expand/collapse link at
                    // the bottom-right (no separate toggle line): justify-between
                    // keeps the holder label left and the blue link hard-right.
                    <span className="flex items-baseline justify-between gap-2 min-w-0">
                      <span
                        ref={(el) => {
                          heldByRefs.current[i] = el;
                        }}
                        className="min-w-0 overflow-hidden text-xs text-text-secondary whitespace-nowrap text-left"
                      >
                        {ownership}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => !e)}
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? 'Show fewer movers'
                            : `Show all ${movers.length} movers`
                        }
                        className="shrink-0 text-xs font-medium text-accent hover:underline whitespace-nowrap tabular-nums"
                      >
                        {expanded
                          ? 'less'
                          : `${movers.length - DISPLAY_COUNT} more`}
                      </button>
                    </span>
                  ) : (
                    <span
                      ref={(el) => {
                        heldByRefs.current[i] = el;
                      }}
                      className="min-w-0 overflow-hidden text-xs text-text-secondary whitespace-nowrap text-left"
                    >
                      {ownership}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
