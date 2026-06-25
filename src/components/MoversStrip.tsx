import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Flame, Info, Eye } from 'lucide-react';
import {
  formatLargeValue,
  formatPERatio,
  formatMarginOrGrowth,
  formatPctTo52WeekHigh,
} from '../utils/formatters';

// Ticker-level fundamentals carried per mover (mirrors MoverFundamentals in
// api/portfolios.ts — the two are separate build targets, keep them in sync).
// These are the same public figures the portfolio detail page's holdings popover
// shows. Any field can be null (ETFs lack revenue/earnings/P/E); the popover
// omits null rows and the "i" button is hidden when every field is null.
export interface MoverFundamentals {
  revenue: number | null;
  earnings: number | null;
  forwardPE: number | null;
  operatingMargin: number | null;
  revenueGrowth3Y: number | null;
  epsGrowth3Y: number | null;
  pctTo52WeekHigh: number | null;
}

export interface MarketMover {
  ticker: string;
  changePercent: number;
  // Handles (portfolio ids) holding this name, in the same order the Users list
  // shows them. See the held-by note below for how they're rendered.
  holders: string[];
  // Fundamentals shown behind the per-row "i" button. Optional so older cached
  // payloads (pre-fundamentals) degrade gracefully — the button just hides.
  fundamentals?: MoverFundamentals;
}

// Whether a mover has any fundamental worth showing — gates the "i" button so
// names with no data (or an older payload missing the field) don't sprout an
// empty popover. Mirrors HoldingsTable's per-holding fundamentals check.
function hasFundamentals(f: MoverFundamentals | undefined): f is MoverFundamentals {
  return (
    !!f &&
    (f.revenue != null ||
      f.earnings != null ||
      f.forwardPE != null ||
      f.operatingMargin != null ||
      f.revenueGrowth3Y != null ||
      f.epsGrowth3Y != null ||
      f.pctTo52WeekHigh != null)
  );
}

interface MoversStripProps {
  movers: MarketMover[];
  // Total view events site-wide today (Pacific day), from the portfolios query.
  // Rendered as a low-key "N views today" social-proof hook in the empty band to
  // the right of the "Top movers" tab. Optional/undefined (older payload or API
  // error) and zero both render no counter — never a bare "0 views today".
  viewsToday?: number;
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
// the backfill only pads UP to the floor, never past it), a blue "N more" link
// sits at the bottom-right of the last row (sharing that row, not a separate
// toggle line) and expands the strip to the full qualified set; "less" collapses
// it back.
//
// Renders nothing on quiet days — an empty strip beats training users that it's
// filler. The server keeps the list populated (see computeMarketMovers). During
// the very first load (no data yet) it instead holds its space with a skeleton,
// so it doesn't pop in above the Users card and shove it down once data arrives.
export function MoversStrip({ movers, viewsToday, isLoading }: MoversStripProps) {
  // Collapsed by default; the viewer can expand to the full qualified list and
  // collapse back. Only offered when the server returned more than DISPLAY_COUNT
  // (i.e. there are qualified movers beyond the default rows to reveal).
  const [expanded, setExpanded] = useState(false);
  const canExpand = movers.length > DISPLAY_COUNT;
  const shown = expanded && canExpand ? movers : movers.slice(0, DISPLAY_COUNT);

  // Fundamentals popover, anchored to the clicked "i" button (mirrors the
  // holdings-table popover on the portfolio detail page): fixed-positioned just
  // below the button, dismissed by a full-screen backdrop.
  const [popover, setPopover] = useState<{
    ticker: string;
    top: number;
    left: number;
  } | null>(null);
  const popoverMover = popover
    ? movers.find((m) => m.ticker === popover.ticker)
    : null;
  const openPopover = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ ticker, top: rect.bottom + 4, left: rect.left });
  };

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

      const next = shown.map((m, idx) => {
        // The last visible row shares its track with the "N more" / "less" link
        // at the bottom-right; reserve its footprint so a holder list that would
        // collide with the link falls back to the shorter count instead.
        const reserve =
          canExpand && idx === shown.length - 1 ? MORE_LINK_RESERVE_PX : 0;
        return (
          ctx.measureText(namesLabel(m)).width + FIT_SLACK_PX + reserve <=
          available
        );
      });
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

  // Views-today hook — a low-key counter that floats in the empty band to the
  // RIGHT of the fixed-width tab, on the same horizontal line as "Top movers"
  // (the tab is only w-36, so the rest of that row is dead space). It's
  // site-wide social proof, deliberately NOT tied to the movers data — muted
  // eye icon + secondary text so it stays clearly subordinate to the tab label.
  // Hidden when the count is absent (older payload / API error) or zero, so it
  // never renders a bare "0 views today". `pr-4` insets it from the card's right
  // edge to match the card body's horizontal padding. NOTE: this lives on the
  // movers strip, so on a genuinely quiet day when the strip self-hides (no
  // movers, not loading) the counter goes with it — acceptable since that's also
  // when there's no "Top movers" row to sit beside.
  const viewsCounter =
    typeof viewsToday === 'number' && viewsToday > 0 ? (
      <span className="flex items-center gap-1.5 pr-4 text-xs md:text-[13px] text-text-secondary whitespace-nowrap">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        <span className="tabular-nums font-medium text-text-primary">
          {viewsToday.toLocaleString()}
        </span>
        <span>views today</span>
      </span>
    ) : null;

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
          <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-2.5 animate-pulse">
            {Array.from({ length: DISPLAY_COUNT }).map((_, i) => (
              <Fragment key={i}>
                <div className="h-3.5 w-12 rounded bg-card-hover" />
                <div className="h-3.5 w-10 justify-self-end rounded bg-card-hover" />
                <div className="h-3 w-32 rounded bg-card-hover" />
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
      {/* Tab row: the folder tab on the left, the views-today counter floated
          into the dead space on its right (same horizontal line). justify-between
          pins them to the two edges; when there's no counter the tab simply stays
          left. items-center vertically centers the counter against the taller tab
          so it reads as the same row as "Top movers". */}
      <div className="flex items-center justify-between">
        {tab}
        {viewsCounter}
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
              const isLast = i === shown.length - 1;
              const heldByLabel = useNames ? namesLabel(mover) : countLabel(mover);
              const showInfo = hasFundamentals(mover.fundamentals);
              return (
                <Fragment key={mover.ticker}>
                  {/* Ticker + optional "i" button. The button opens a
                      fundamentals popover (revenue, earnings, forward P/E, …) —
                      same data and look as the holdings table on the detail
                      page. It shares the ticker's auto grid column, so the move
                      and held-by columns stay aligned across rows. */}
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="font-semibold text-text-primary text-sm md:text-[15px]">
                      {mover.ticker}
                    </span>
                    {showInfo && (
                      <button
                        type="button"
                        onClick={(e) => openPopover(mover.ticker, e)}
                        aria-label={`Fundamentals for ${mover.ticker}`}
                        className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                        className="text-xs text-text-secondary whitespace-nowrap text-left"
                      >
                        {heldByLabel}
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
                      className="text-xs text-text-secondary whitespace-nowrap text-left"
                    >
                      {heldByLabel}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Fundamentals popover — opened by a row's "i" button, anchored just
          below it. Same shape and figures as the holdings-table popover on the
          portfolio detail page; only the rows with data render. A fixed
          full-screen backdrop closes it on any outside click. */}
      {popover && popoverMover?.fundamentals && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-64"
            style={{ top: popover.top, left: popover.left }}
          >
            <p className="font-semibold text-text-primary text-sm mb-2">{popover.ticker}</p>
            <div className="grid grid-cols-1 gap-y-1 text-xs">
              {popoverMover.fundamentals.revenue != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Revenue</span>
                  <span className="font-medium text-text-primary">{formatLargeValue(popoverMover.fundamentals.revenue)}</span>
                </div>
              )}
              {popoverMover.fundamentals.earnings != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Earnings</span>
                  <span className="font-medium text-text-primary">{formatLargeValue(popoverMover.fundamentals.earnings)}</span>
                </div>
              )}
              {popoverMover.fundamentals.forwardPE != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Forward P/E</span>
                  <span className="font-medium text-text-primary">{formatPERatio(popoverMover.fundamentals.forwardPE)}</span>
                </div>
              )}
              {popoverMover.fundamentals.operatingMargin != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Op Margin</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverMover.fundamentals.operatingMargin)}</span>
                </div>
              )}
              {popoverMover.fundamentals.revenueGrowth3Y != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Revenue Growth (3Y)</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverMover.fundamentals.revenueGrowth3Y)}</span>
                </div>
              )}
              {popoverMover.fundamentals.epsGrowth3Y != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">EPS Growth (3Y)</span>
                  <span className="font-medium text-text-primary">{formatMarginOrGrowth(popoverMover.fundamentals.epsGrowth3Y)}</span>
                </div>
              )}
              {popoverMover.fundamentals.pctTo52WeekHigh != null && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">% to 52wk high</span>
                  <span className="font-medium text-text-primary">{formatPctTo52WeekHigh(popoverMover.fundamentals.pctTo52WeekHigh)}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
