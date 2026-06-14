import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Flame } from 'lucide-react';

export interface MarketMover {
  ticker: string;
  changePercent: number;
  // Handles (portfolio ids) holding this name, in the same order the Users list
  // shows them. See the held-by note below for how they're rendered.
  holders: string[];
}

interface MoversStripProps {
  movers: MarketMover[];
}

// How many movers the pill shows by default (one per row) — the collapsed size.
// The server floors the list at the same count (MOVER_MIN_COUNT in
// api/portfolios.ts) so the rows are never short; keep the two in sync. When the
// server returns more than this, every extra name is a qualified mover (the
// backfill only ever pads UP to this floor, never past it), so a "Show all"
// toggle can safely expand the pill to the full qualified set and collapse back.
const DISPLAY_COUNT = 3;

// Slack (px) required beyond the measured text width before we commit to the
// names variant — covers the gap between canvas measureText and real layout
// (letter-spacing, sub-pixel rounding) so a row that "just barely" fits doesn't
// clip a character.
const FIT_SLACK_PX = 4;

// The per-row "who holds this" label. We prefer naming the holders outright —
// "held by AB, CD" — over a bare count, because the names are the same handles
// the Users list shows, so a viewer can recognize themselves and others. But a
// widely-held name's full list won't fit one row, so each row independently
// falls back to a count ("held by 3 users") when the names would overflow (see
// the fit measurement in the component). The handles are uppercased to match
// the Users list, which renders portfolio.id.toUpperCase().
function namesLabel(m: MarketMover): string {
  return `held by ${m.holders.map((h) => h.toUpperCase()).join(', ')}`;
}
function countLabel(m: MarketMover): string {
  const n = m.holders.length;
  return `held by ${n} ${n === 1 ? 'user' : 'users'}`;
}

// Rounded card directly above the Users card (spans its width). A folder-style
// TAB juts from the card's top-left — a flame beside the words "Top movers" —
// naming the strip and framing the per-row holders as "users here." The tab
// carries no bottom border and paints above the card body
// (z-10), so the card's top border is hidden beneath it and the two read as one
// connected shape (a notepad tab). Moving the label off the old left rail and
// onto the tab hands the rows the FULL card width. Each mover is one row:
// ticker | day move | "held by …".
//
// The day move is right-aligned in an auto column (so the percentages line up on
// their right edge); the holders are the flexible (1fr) track, left-aligned so
// the label begins just past the percentage (one gap-x over) rather than being
// shoved to the card's right edge — the reclaimed full width still buys us far
// more room for the holder names before a row has to fall back to a count.
//
// Holders column — names when they fit, else a count. We measure (canvas
// measureText against the column's real available width) whether a row's full
// "held by AB, CD" string fits; if it does we list the handles, otherwise that
// row alone falls back to "held by N users". The decision is per-row and
// width-driven, so it adapts to viewport width and to how many people hold a
// given name. Measuring happens in a layout effect (before paint, so no flash)
// and re-runs on container resize. The available width is the holders track's
// span from its left edge to the container's right edge (cell alignment within
// the track doesn't move that left edge, so the left-aligned text has exactly
// that span to grow into).
//
// The flame is the lucide-react Flame icon — a single-color, thin-stroke line
// flame in amber (text-amber-500), monochromatic with no second shade. This is
// the original look the user preferred; it renders identically across platforms
// (unlike the native 🔥 emoji, which the platform paints in its own multi-shaded
// art). A native emoji and a two-tone SVG are both kept in git history.
//
// Expand/collapse: by default the strip shows DISPLAY_COUNT rows (the collapsed
// size). When the server returns more (every extra row is a qualified mover —
// the backfill only pads UP to the floor, never past it), a centered "N more"
// chevron toggle below the rows expands the strip to the full qualified set and
// collapses it back.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers).
export function MoversStrip({ movers }: MoversStripProps) {
  // Collapsed by default; the viewer can expand to the full qualified list and
  // collapse back. Only offered when the server returned more than DISPLAY_COUNT
  // (i.e. there are qualified movers beyond the default rows to reveal).
  const [expanded, setExpanded] = useState(false);
  const canExpand = movers.length > DISPLAY_COUNT;
  const shown = expanded && canExpand ? movers : movers.slice(0, DISPLAY_COUNT);

  // Per-row: does the full holder-names string fit its column? Default false
  // (count) so the pre-measurement render never overflows; the layout effect
  // upgrades rows that fit before the browser paints.
  const [fitNames, setFitNames] = useState<boolean[]>([]);

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

      const next = shown.map(
        (m) => ctx.measureText(namesLabel(m)).width + FIT_SLACK_PX <= available
      );
      setFitNames((prev) =>
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

  if (shown.length === 0) return null;

  return (
    <div
      className="mb-3 md:mb-6"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Folder tab jutting from the card's top-left: flame + label. No bottom
          border, and z-10 so it paints OVER the card body below — the card's top
          border is hidden beneath the tab and the two read as one connected
          notepad-tab shape. A FIXED width (w-36) is shared by all three
          landing-page tabs (movers / upcoming / users) — sized to the widest
          label ("Top movers") — so the stacked tabs line up at a constant width
          instead of each sizing to its own label; content stays left-aligned so
          the tab icons align in a column down the stack. The lucide Flame is a
          single-color thin-stroke amber flame (no second shade), identical
          across platforms — the look the user preferred over the native 🔥. */}
      <div className="relative z-10 flex w-36 items-center gap-1.5 bg-card border border-border border-b-0 rounded-t-xl px-3 py-1.5">
        <Flame className="w-3.5 h-3.5 text-amber-500" aria-hidden />
        <span className="text-[13px] md:text-sm font-semibold text-text-primary whitespace-nowrap">
          Top movers
        </span>
      </div>

      {/* Card body. Top-left squared (rounded-tl-none) so its left border lines
          up flush beneath the tab's left border; pulled up 1px (-mt-px) to
          overlap the tab's missing bottom border into one seamless edge. Rows
          get the full width now that the label lives on the tab, not a rail. */}
      <div className="-mt-px bg-card border border-border rounded-3xl rounded-tl-none px-4 py-2.5">
        <div ref={containerRef} className="w-full min-w-0">
          {/* ticker | move (right-aligned, percentages line up) | held-by (the
              flexible 1fr track, left-aligned so it starts just past the %). */}
          <div className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 gap-y-1">
            {shown.map((mover, i) => {
              const isPositive = mover.changePercent >= 0;
              const useNames = fitNames[i] ?? false;
              return (
                <Fragment key={mover.ticker}>
                  <span className="font-semibold text-text-primary text-sm md:text-[15px] whitespace-nowrap">
                    {mover.ticker}
                  </span>
                  <span className={`text-sm md:text-[15px] tabular-nums text-right whitespace-nowrap ${isPositive ? 'text-positive' : 'text-negative'}`}>
                    {isPositive ? '+' : ''}{mover.changePercent.toFixed(1)}%
                  </span>
                  <span
                    ref={(el) => {
                      heldByRefs.current[i] = el;
                    }}
                    className="text-xs text-text-secondary whitespace-nowrap text-left"
                  >
                    {useNames ? namesLabel(mover) : countLabel(mover)}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Centered "N more" / "less" toggle below the rows. "N more" (not a
            bare "+N") so it's obvious the number counts additional movers. Only
            shown when the server returned more than DISPLAY_COUNT qualified
            rows. */}
        {canExpand && (
          <div className="flex justify-center mt-1.5">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={
                expanded ? 'Show fewer movers' : `Show all ${movers.length} movers`
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
                      {movers.length - DISPLAY_COUNT}
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
