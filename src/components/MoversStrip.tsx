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

// Rounded pill directly above the Users card (spans its width). A left rail —
// the word "Top movers" under a flame — names the strip and frames the per-row
// holders as "users here," which the old icon-only version left users guessing
// at. The rail is anchored to the pill's LEFT edge (a label, echoing the
// left-aligned Users heading below); the movers are LEFT-aligned right beside
// it (justify-start), shifted hard left to use the empty space that an earlier
// centered layout left between the rail and the data. Each mover is one row:
// ticker | day move | "held by …", three TIGHTLY grouped columns.
//
// The three columns are kept adjacent (no flexible spacer between them) so the
// move sits right next to its ticker and the holders right next to the move — a
// version that pushed the holders to the pill's far right opened an awkward gap
// between a stock and its own "held by" text.
//
// Holders column — names when they fit, else a count. We measure (canvas
// measureText against the column's real available width) whether a row's full
// "held by AB, CD" string fits; if it does we list the handles, otherwise that
// row alone falls back to "held by N users". The decision is per-row and
// width-driven, so it adapts to viewport width and to how many people hold a
// given name. Measuring happens in a layout effect (before paint, so no flash)
// and re-runs on container resize. The available width is the column's leftover
// after the ticker + move columns, which left-alignment makes a clean
// container-left-to-cell-left span.
//
// The flame is the lucide-react Flame icon — a single-color, thin-stroke line
// flame in amber (text-amber-500), monochromatic with no second shade. This is
// the original look the user preferred; it renders identically across platforms
// (unlike the native 🔥 emoji, which the platform paints in its own multi-shaded
// art). A native emoji and a two-tone SVG are both kept in git history.
//
// Stacking the flame ABOVE the label (rather than beside it) shrinks the rail
// to the label's width, which is what lets a single row fit even a 360px phone.
// Type is a notch smaller on mobile (text-sm/[15px]) than desktop
// (text-[15px]/base) to hold that fit; the gap also tightens on mobile (gap-3
// vs gap-5). Two tickers per row never fit, so we don't try.
//
// Expand/collapse: by default the pill shows DISPLAY_COUNT rows (the collapsed
// size). When the server returns more (every extra row is a qualified mover —
// the backfill only pads UP to the floor, never past it), a small "N more"
// chevron toggle tucked under the rail's "Top movers" label expands the pill to
// the full qualified set and collapses it back. It lives in the rail's spare
// vertical room (the rail is shorter than the ≥3-row movers block) and stays
// narrower than the label, so it costs the pill neither an extra row of height
// nor any of the horizontal width the single-row mobile fit depends on — it
// never touches the movers' own rows. (A full-width toggle row beneath the
// strip, the obvious first cut, was rejected for grabbing exactly that scarce
// vertical space.)
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
      // left-alignment means the grid sits at the container's left edge, so the
      // cell's offset from the container left is exactly that prefix width.
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
      className="mb-3 md:mb-6 bg-card border border-border rounded-3xl px-4 py-2.5 flex items-center gap-3 md:gap-5"
      aria-label="Today's movers among tracked holdings"
    >
      {/* Left rail: flame above the label, anchored to the pill's left edge so
          it reads as a label (echoing the left-aligned Users heading below). The
          expand/collapse toggle tucks UNDER the label in the rail's spare
          vertical room — the rail is shorter than the (≥3-row) movers block, so
          a chevron here costs the pill no extra height, and it stays narrower
          than "Top movers" so it costs no width either. That keeps the toggle
          off the movers' own rows, which the single-row mobile fit can't spare. */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        {/* The lucide Flame icon: a single-color, thin-stroke flame in amber —
            monochromatic (no second shade), and identical across platforms. This
            is the original look the user preferred over the native 🔥. */}
        <Flame className="w-4 h-4 text-amber-500" aria-hidden />
        <span className="text-[15px] md:text-base font-semibold text-text-primary whitespace-nowrap">
          Top movers
        </span>
        {canExpand && (
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
                {/* "N more" (not a bare "+N") so it's obvious the number counts
                    additional movers, not something cryptic. Stays narrower than
                    the "Top movers" label, so the rail width — and the movers'
                    horizontal space — is unchanged. */}
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
        )}
      </div>

      {/* Movers grouped tightly (ticker | move | held-by adjacent) and
          left-aligned beside the rail (justify-start), shifted hard left to use
          the space a centered layout wasted, while a row's own pieces never
          separate. */}
      <div ref={containerRef} className="flex-1 flex justify-start min-w-0">
        <div className="grid grid-cols-[auto_auto_auto] items-baseline gap-x-3 gap-y-1">
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
                  className="text-xs text-text-secondary whitespace-nowrap"
                >
                  {useNames ? namesLabel(mover) : countLabel(mover)}
                </span>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
