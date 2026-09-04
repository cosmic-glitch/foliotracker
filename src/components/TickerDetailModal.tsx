import { useEffect, useMemo, useRef, useState } from 'react';
import { getMarketStatus } from '../lib/market-hours';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea } from 'recharts';
import { TICKER_RANGES, useTickerHistory, type TickerRange } from '../hooks/useTickerHistory';
import { useTickerNews } from '../hooks/usePortfolioNews';
import {
  formatChartDate,
  formatLargeValue,
  formatMarginOrGrowth,
  formatPERatio,
  formatPctTo52WeekHigh,
  formatPercent,
  formatPrice,
} from '../utils/formatters';

// Per-ticker detail sheet opened by clicking a ticker in HoldingsTable or the
// landing-page MoversStrip. Replaces the old "i" fundamentals popovers: same
// fields, plus a raw price chart of the ticker itself and the ticker's AI news
// summary. Deliberately says nothing about any position — the row the user
// clicked already shows it, and "your position" reads wrong on someone else's
// portfolio. Only ever mounted where the figures are already visible
// (full-access holdings view, public movers), so it needs no gating of its own.

// The minimum a caller must know about a ticker. `Holding` satisfies it
// structurally; MoversStrip builds one from a MarketMover.
export interface TickerDetailSubject {
  ticker: string;
  name?: string | null;
  instrumentType: string;
  currentPrice: number;
  previousClose: number;
  dayChangePercent: number;
  // Optional session prices (Holding has both; movers don't). With both
  // present the header can split the day into at-close / extended figures.
  regularMarketPrice?: number;
  extendedPrice?: number;
  revenue?: number | null;
  earnings?: number | null;
  peRatio?: number | null;
  forwardPE?: number | null;
  forwardPENext?: number | null;
  operatingMargin?: number | null;
  revenueGrowth3Y?: number | null;
  epsGrowth3Y?: number | null;
  pctTo52WeekHigh?: number | null;
  week52High?: number | null;
}

// One line under the header price: either the plain per-share day change
// (unlabelled) or a labelled session price with its move.
type HeaderRow =
  | { label: null; change: number; percent: number }
  | { label: string; price: number; percent: number | null };

interface TickerDetailModalProps {
  subject: TickerDetailSubject;
  onClose: () => void;
}

interface ChartPoint {
  date: string; // as served: YYYY-MM-DD, or a full ISO timestamp on the intraday range
  timestamp: number;
  close: number;
}

const NO_MATERIAL_NEWS_SENTINEL = 'No material news in the last 7 days.';

const NEWS_INSTRUMENT_TYPES = new Set([
  'Common Stock',
  'American Depositary Receipt',
  'ETF',
  'Mutual Fund',
]);

const GRID_STROKE = 'var(--color-border)';
const AXIS_FONT_SIZE = 11;
// Gap between y tick text and the axis line. Recharts positions the text at
// tickSize + tickMargin from the line even with the tick line hidden, so the
// YAxis below sets tickSize=0 and tickMargin to this value.
const Y_TICK_INSET = 4;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PREVIOUS_CLOSE_STROKE = '#94a3b8';

// Intraday session bounds as ms timestamps: `start`/`end` bound the regular
// session, `preStart`/`postEnd` the extended one. Always drawn in full — the
// detail panel shows the extended tape regardless of the app's Extended Hours
// toggle, which only governs whether portfolio values move after the close.
interface IntradaySession {
  preStart: number;
  start: number;
  end: number;
  postEnd: number;
}
// Same tints as PerformanceChart's 1D bands so the two charts read alike.
const SESSION_BANDS: { key: keyof IntradaySession; to: keyof IntradaySession; fill: string; opacity: number }[] = [
  { key: 'preStart', to: 'start', fill: '#14b8a6', opacity: 0.14 },
  { key: 'start', to: 'end', fill: '#3b82f6', opacity: 0.07 },
  { key: 'end', to: 'postEnd', fill: '#e11d48', opacity: 0.14 },
];

// Intraday labels are shown in Eastern time regardless of the viewer's zone:
// the session bounds (9:30–4) only read correctly in ET, and the rest of the
// app already speaks ET for market hours.
const ET_HOUR = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: 'America/New_York' });
const ET_TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

// Smallest number of decimals (≤ 4) that renders `x` exactly, so tick labels
// show "$2.50" for a 2.5 step but "$105" for a 5 step.
function decimalsFor(x: number): number {
  for (let d = 0; d < 4; d++) {
    const scaled = x * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 4;
}

// Round `raw` up to the nearest 1 / 2 / 2.5 / 5 × 10^k.
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = [1, 2, 2.5, 5, 10].find((n) => n >= normalized - 1e-9) ?? 10;
  return nice * magnitude;
}

// Width of the y-axis column, sized to the widest tick label so the plot hugs
// the left edge. The range selector row above the chart is padded by the same
// amount so it lines up with the plot area rather than the axis labels.
let measureCanvas: CanvasRenderingContext2D | null | undefined;
function measureYAxisWidth(labels: string[]): number {
  if (measureCanvas === undefined) measureCanvas = document.createElement('canvas').getContext('2d');
  let textWidth: number;
  if (measureCanvas) {
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    measureCanvas.font = `${AXIS_FONT_SIZE}px ${family}`;
    textWidth = Math.max(...labels.map((l) => measureCanvas!.measureText(l).width));
  } else {
    textWidth = Math.max(...labels.map((l) => l.length)) * AXIS_FONT_SIZE * 0.6;
  }
  return Math.ceil(textWidth) + Y_TICK_INSET + 1;
}

// Evenly spaced y ticks on round prices, with the domain snapped to the
// outermost ticks so the grid's top and bottom lines frame the plot. Recharts
// would otherwise pin ticks to the raw padded min/max, which bunches the
// first two labels together.
function buildYAxis(closes: number[]): { domain: [number, number]; ticks: number[]; format: (v: number) => string; width: number } {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min > 0 ? max - min : Math.max(Math.abs(max) * 0.02, 0.01);
  const step = niceStep(span / 4);
  const pad = span * 0.05;
  const lo = Math.floor((min - pad) / step) * step;
  const hi = Math.ceil((max + pad) / step) * step;
  const decimals = decimalsFor(step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)));
  // Six-figure prices (BRK.A) are compacted to "$700k" so the axis column stays narrow.
  const kDecimals = decimalsFor(step / 1_000);
  const format = (v: number) => (Math.abs(v) >= 10_000 ? `$${(v / 1_000).toFixed(kDecimals)}k` : `$${v.toFixed(decimals)}`);
  return { domain: [lo, hi], ticks, format, width: measureYAxisWidth(ticks.map(format)) };
}

interface XAxisSpec {
  domain: [number, number];
  ticks: number[];
  format: (ts: number) => string;
}

// Intraday: the x-domain is the whole extended session (4 a.m.–8 p.m. ET,
// not just the bars so far), so a mid-session chart fills in left-to-right as
// the day goes on instead of stretching the partial day across the full
// width. Ticks sit every two hours from the domain's first whole hour; ET
// hour boundaries coincide with UTC ones, so plain ms rounding finds them.
// The session bounds are widened to cover the data in case Yahoo's
// `currentTradingPeriod` is for a different day than the bars it returned.
function buildIntradayXAxis(points: ChartPoint[], session: IntradaySession | null): XAxisSpec {
  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const lo = Math.min(first, session?.preStart ?? first);
  const hi = Math.max(last, session?.postEnd ?? last);
  const edge = (hi - lo) * 0.04;
  const stepMs = hi - lo > 8 * HOUR_MS ? 2 * HOUR_MS : HOUR_MS;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / HOUR_MS) * HOUR_MS; t <= hi; t += stepMs) {
    if (t >= lo + edge && t <= hi - edge) ticks.push(t);
  }
  return { domain: [lo, hi], ticks, format: (ts) => ET_HOUR.format(new Date(ts)) };
}

// X ticks on calendar boundaries (Mondays / month starts / year starts,
// thinned to ≤ ~8), excluding the outer 4% of the span so the first and last
// labels don't hang past the plot edges. Recharts' own tick picking puts a
// tick at dataMin, whose centered label would spill under the y axis.
function buildXAxis(points: ChartPoint[]): XAxisSpec {
  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const spanDays = (last - first) / DAY_MS;
  const start = new Date(first);
  const dates: Date[] = [];
  let fmt: Intl.DateTimeFormat;
  let labelYearOnJan = false;

  if (spanDays <= 45) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= last; d.setDate(d.getDate() + 7)) dates.push(new Date(d));
    fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  } else if (spanDays <= 400) {
    const monthStep = spanDays <= 220 ? 1 : 2;
    const d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    for (; d.getTime() <= last; d.setMonth(d.getMonth() + 1)) {
      if (d.getMonth() % monthStep === 0) dates.push(new Date(d));
    }
    fmt = new Intl.DateTimeFormat('en-US', { month: 'short' });
    labelYearOnJan = true;
  } else {
    const years = spanDays / 365;
    const yearStep = years <= 8 ? 1 : Math.ceil(years / 8);
    const d = new Date(start.getFullYear() + 1, 0, 1);
    for (; d.getTime() <= last; d.setFullYear(d.getFullYear() + 1)) {
      if (d.getFullYear() % yearStep === 0) dates.push(new Date(d));
    }
    fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
  }

  const edge = (last - first) * 0.04;
  const ticks = dates.map((d) => d.getTime()).filter((ts) => ts >= first + edge && ts <= last - edge);
  const format = (ts: number) => {
    const d = new Date(ts);
    if (labelYearOnJan && d.getMonth() === 0) return `${fmt.format(d)} ${d.getFullYear()}`;
    return fmt.format(d);
  };
  return { domain: [first, last], ticks, format };
}

function ChartTooltip({
  active,
  payload,
  intraday,
  session,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  intraday?: boolean;
  session?: IntradaySession | null;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  let when = formatChartDate(point.date);
  if (intraday) {
    when = `${when}, ${ET_TIME.format(new Date(point.timestamp))} ET`;
    if (session && point.timestamp < session.start) when += ' · Pre-market';
    else if (session && point.timestamp >= session.end) when += ' · After hours';
  }
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{when}</p>
      <p className="text-sm text-text-primary font-semibold">{formatPrice(point.close)}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">{children}</h3>;
}

export function TickerDetailModal({ subject: holding, onClose }: TickerDetailModalProps) {
  const [range, setRange] = useState<TickerRange>('1y');
  const history = useTickerHistory(holding.ticker, range);
  const showNews = NEWS_INSTRUMENT_TYPES.has(holding.instrumentType);
  const news = useTickerNews(showNews ? holding.ticker : null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const intraday = range === '1d';
  // Only meaningful once the intraday response has landed; the daily+ ranges
  // serve these as null.
  const previousClose = intraday ? history.data?.previousClose ?? null : null;
  const session = useMemo<IntradaySession | null>(() => {
    const s = intraday ? history.data?.session : null;
    if (!s) return null;
    return { preStart: Date.parse(s.preStart), start: Date.parse(s.start), end: Date.parse(s.end), postEnd: Date.parse(s.postEnd) };
  }, [intraday, history.data?.session]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!history.data) return [];
    return history.data.points.map((p) => {
      if (p.date.includes('T')) return { date: p.date, timestamp: Date.parse(p.date), close: p.close };
      const [year, month, day] = p.date.split('-').map(Number);
      return { date: p.date, timestamp: new Date(year, month - 1, day).getTime(), close: p.close };
    });
  }, [history.data]);

  // Change over the selected range: first close → last close of the series.
  // Daily+ ranges only: the header already labels the intraday move, and a
  // second unlabelled figure for the same day proved confusing.
  const rangeChange = useMemo(() => {
    if (intraday || chartData.length < 2) return null;
    const base = chartData[0].close;
    const last = chartData[chartData.length - 1].close;
    if (!(base > 0)) return null;
    return ((last - base) / base) * 100;
  }, [chartData, intraday]);

  const axes = useMemo(() => {
    if (chartData.length === 0) return null;
    const closes = chartData.map((d) => d.close);
    // The previous-close baseline must sit inside the y-range to be visible.
    if (previousClose != null) closes.push(previousClose);
    return {
      x: intraday ? buildIntradayXAxis(chartData, session) : buildXAxis(chartData),
      y: buildYAxis(closes),
    };
  }, [chartData, intraday, previousClose, session]);

  // Inset for the range-selector row (see measureYAxisWidth). Held across
  // loads: a fresh symbol+range pair has no data while it fetches, and
  // letting the inset collapse to 0 made the buttons jump left and back on
  // every first visit to a range. Seeded from the current price so the first
  // open lands close to where the real axis will.
  const selectorInset = useRef<number | null>(null);
  if (axes) selectorInset.current = axes.y.width;
  else if (selectorInset.current === null && holding.currentPrice > 0) {
    selectorInset.current = buildYAxis([holding.currentPrice * 0.9, holding.currentPrice * 1.1]).width;
  }

  // The Pre/Regular/AH key only earns its space when the tape actually has an
  // extended session to distinguish.
  const showSessionLegend =
    session != null && session.postEnd > session.preStart && session.end - session.start < session.postEnd - session.preStart;

  // Header prices ignore the app's Extended Hours toggle, like the chart
  // below (which always draws the whole tape): the big figure is the latest
  // extended-hours price, and outside the regular session the day is split
  // into labelled rows — "At close" (official close vs. previous close) and
  // "After hours" (latest vs. that close), or "Prev close" / "Pre-market"
  // before the open — so each percentage says what it measures. Following
  // the toggle here made two viewers of the same ticker see different
  // headers over an identical chart. Collapses to one price + change during
  // the session, for movers (no session prices), and when nothing has
  // traded outside regular hours.
  const header = useMemo<{ price: number; rows: HeaderRow[] }>(() => {
    const latest = holding.extendedPrice ?? holding.currentPrice;
    const close = holding.regularMarketPrice;
    const prev = holding.previousClose;
    const pct = (to: number, from: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
    const status = getMarketStatus();
    const split = close != null && close > 0 && Math.abs(latest - close) > 1e-6 && status !== 'open';
    if (!split) {
      return { price: latest, rows: [{ label: null, change: latest - prev, percent: pct(latest, prev) }] };
    }
    if (status === 'pre-market') {
      return {
        price: latest,
        rows: [
          { label: 'Prev close', price: prev, percent: null },
          { label: 'Pre-market', price: latest, percent: pct(latest, prev) },
        ],
      };
    }
    return {
      price: latest,
      rows: [
        { label: 'At close', price: close, percent: pct(close, prev) },
        { label: 'After hours', price: latest, percent: pct(latest, close) },
      ],
    };
  }, [holding.extendedPrice, holding.currentPrice, holding.regularMarketPrice, holding.previousClose]);

  const hasFundamentals =
    holding.revenue != null ||
    holding.earnings != null ||
    holding.peRatio != null ||
    holding.forwardPE != null ||
    holding.forwardPENext != null ||
    holding.operatingMargin != null ||
    holding.revenueGrowth3Y != null ||
    holding.epsGrowth3Y != null ||
    holding.pctTo52WeekHigh != null ||
    holding.week52High != null;

  // Summary generation is gated to a pilot portfolio for ETFs/MFs (see
  // scripts/prepare-news-input.ts), so a missing entry means "pending" for a
  // stock but "not generated for this ticker" for a fund — hide the section
  // rather than promise a summary that may never arrive (mirrors NewsSection).
  const newsEntry = news.data?.news[holding.ticker];
  const newsMarkdown =
    newsEntry && newsEntry.summaryMarkdown.trim() !== NO_MATERIAL_NEWS_SENTINEL
      ? newsEntry.summaryMarkdown.trim()
      : null;
  const isEtfLike = holding.instrumentType === 'ETF' || holding.instrumentType === 'Mutual Fund';
  const hideNews = !news.isLoading && !news.error && !newsEntry && isEtfLike;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      {/* Bottom sheet on mobile, centered dialog from `sm` up. The mobile
          sheet has a FIXED height (not max-height) so it always reaches near
          the top of the screen and scrolls inside: content-sized, it would
          grow when the news query resolved a beat after the fundamentals,
          which read as a jitter. dvh so mobile browser chrome doesn't clip it. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="holding-detail-title"
        className="relative w-full sm:max-w-lg h-[94dvh] sm:h-auto sm:max-h-[85vh] overflow-y-auto bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl"
      >
        <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="holding-detail-title" className="text-lg font-semibold text-text-primary leading-tight">
              {holding.ticker}
            </h2>
            {holding.name && holding.name !== holding.ticker && (
              <p className="text-sm text-text-secondary truncate">{holding.name}</p>
            )}
          </div>
          <div className="flex items-start gap-3 shrink-0">
            <div className="text-right">
              <p className="font-semibold text-text-primary leading-tight">{formatPrice(header.price)}</p>
              {header.rows.map((row) =>
                row.label === null ? (
                  <p key="change" className={`text-xs leading-snug ${row.percent >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {row.change >= 0 ? '+' : '-'}{formatPrice(Math.abs(row.change))} ({formatPercent(row.percent)})
                  </p>
                ) : (
                  <p key={row.label} className="text-xs leading-snug">
                    <span className="text-text-secondary">{row.label} </span>
                    <span className="text-text-primary">{formatPrice(row.price)}</span>
                    {row.percent != null && (
                      <span className={row.percent >= 0 ? 'text-positive' : 'text-negative'}> ({formatPercent(row.percent)})</span>
                    )}
                  </p>
                )
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 -mr-1 hover:bg-background rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
        </div>

        <div className="px-4 py-4 space-y-5">
          {/* Price history */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-2" style={{ paddingLeft: selectorInset.current ?? 0 }}>
              <div className="flex gap-1">
                {TICKER_RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRange(r.value)}
                    className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
                      range === r.value
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:text-text-primary hover:bg-card-hover'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {rangeChange != null && (
                <span className={`text-sm font-semibold ${rangeChange >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {formatPercent(rangeChange)}
                </span>
              )}
            </div>
            <div className="h-48 sm:h-56">
              {history.isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : history.error || !axes ? (
                <div className="h-full flex items-center justify-center text-sm text-text-secondary">
                  No price history available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    {session &&
                      SESSION_BANDS.map((b) =>
                        session[b.to] > session[b.key] ? (
                          <ReferenceArea key={b.key} x1={session[b.key]} x2={session[b.to]} fill={b.fill} fillOpacity={b.opacity} ifOverflow="visible" />
                        ) : null
                      )}
                    <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      scale="time"
                      domain={axes.x.domain}
                      ticks={axes.x.ticks}
                      axisLine={{ stroke: GRID_STROKE }}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: AXIS_FONT_SIZE }}
                      tickFormatter={axes.x.format}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={axes.y.domain}
                      ticks={axes.y.ticks}
                      axisLine={{ stroke: GRID_STROKE }}
                      tickLine={false}
                      tickSize={0}
                      tickMargin={Y_TICK_INSET}
                      tick={{ fill: '#94a3b8', fontSize: AXIS_FONT_SIZE }}
                      tickFormatter={axes.y.format}
                      width={axes.y.width}
                    />
                    <Tooltip content={<ChartTooltip intraday={intraday} session={session} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                    {previousClose != null && (
                      <ReferenceLine y={previousClose} stroke={PREVIOUS_CLOSE_STROKE} strokeDasharray="4 4" strokeOpacity={0.7} />
                    )}
                    <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            {showSessionLegend && (
              <div className="flex items-center gap-2.5 pt-1 text-[10px] text-text-secondary" style={{ paddingLeft: selectorInset.current ?? 0 }}>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-teal-400/90" />
                  Pre
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500/80" />
                  Regular
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500/90" />
                  AH
                </span>
              </div>
            )}
          </section>

          {/* Fundamentals — the same fields the retired "i" popover showed.
              No heading: with the position section gone this is the only
              stats block, so a label would just cost space. */}
          {hasFundamentals && (
            <section>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {holding.revenue != null && <Stat label="Revenue" value={formatLargeValue(holding.revenue)} />}
                {holding.earnings != null && <Stat label="Earnings" value={formatLargeValue(holding.earnings)} />}
                {holding.peRatio != null && <Stat label="Trailing PE" value={formatPERatio(holding.peRatio)} />}
                {holding.forwardPE != null && <Stat label="Forward PE" value={formatPERatio(holding.forwardPE)} />}
                {holding.forwardPENext != null && <Stat label="Forward PE (next FY)" value={formatPERatio(holding.forwardPENext)} />}
                {holding.operatingMargin != null && <Stat label="Operating margin" value={formatMarginOrGrowth(holding.operatingMargin)} />}
                {holding.revenueGrowth3Y != null && <Stat label="Revenue growth (3Y)" value={formatMarginOrGrowth(holding.revenueGrowth3Y)} />}
                {holding.epsGrowth3Y != null && <Stat label="EPS growth (3Y)" value={formatMarginOrGrowth(holding.epsGrowth3Y)} />}
                {holding.week52High != null && <Stat label="52-week high" value={formatPrice(holding.week52High)} />}
                {holding.pctTo52WeekHigh != null && <Stat label="% to 52-week high" value={formatPctTo52WeekHigh(holding.pctTo52WeekHigh)} />}
              </div>
            </section>
          )}

          {/* News */}
          {showNews && !hideNews && (
            <section>
              <SectionTitle>News</SectionTitle>
              {news.isLoading ? (
                <p className="text-sm text-text-secondary">Loading news...</p>
              ) : news.error ? (
                <p className="text-sm text-text-secondary">Failed to load news</p>
              ) : newsMarkdown ? (
                <div className="text-sm text-text-primary prose prose-sm max-w-none prose-ul:my-0 prose-li:my-0.5 prose-p:my-0 prose-strong:text-text-primary prose-a:text-accent prose-a:no-underline hover:prose-a:underline marker:text-text-secondary">
                  <ReactMarkdown>{newsMarkdown}</ReactMarkdown>
                  <p className="not-prose mt-2 text-[11px] text-text-secondary">Last updated: {newsEntry!.summaryDate}</p>
                </div>
              ) : newsEntry ? (
                <p className="text-sm text-text-secondary">{NO_MATERIAL_NEWS_SENTINEL}</p>
              ) : (
                <p className="text-sm italic text-text-secondary">Summary pending</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
