import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { Holding } from '../types/portfolio';
import { TICKER_RANGES, useTickerHistory, type TickerRange } from '../hooks/useTickerHistory';
import { usePortfolioNews } from '../hooks/usePortfolioNews';
import {
  formatChartDate,
  formatLargeValue,
  formatMarginOrGrowth,
  formatPERatio,
  formatPctTo52WeekHigh,
  formatPercent,
  formatPrice,
} from '../utils/formatters';

// Per-holding detail sheet opened by clicking a ticker in HoldingsTable.
// Replaces the old "i" fundamentals popover: same fields, plus a raw price
// chart of the ticker itself and the ticker's AI news summary. Deliberately
// says nothing about the position — the holdings row the user clicked already
// shows it, and "your position" reads wrong on someone else's portfolio. Only ever mounted from the full-access
// holdings view — allocation-only viewers never see HoldingsTable — so
// nothing in here needs its own dollar gating.

interface HoldingDetailModalProps {
  holding: Holding;
  onClose: () => void;
}

interface ChartPoint {
  date: string;
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
// Recharts offsets tick text from the axis line by tickSize (6) + tickMargin
// (2) even with the tick line hidden.
const Y_TICK_INSET = 8;
const DAY_MS = 86_400_000;

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
  return Math.ceil(textWidth) + Y_TICK_INSET + 2;
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

// X ticks on calendar boundaries (Mondays / month starts / year starts,
// thinned to ≤ ~8), excluding the outer 4% of the span so the first and last
// labels don't hang past the plot edges. Recharts' own tick picking puts a
// tick at dataMin, whose centered label would spill under the y axis.
function buildXAxis(points: ChartPoint[]): { ticks: number[]; format: (ts: number) => string } {
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
  return { ticks, format };
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{formatChartDate(point.date)}</p>
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

export function HoldingDetailModal({ holding, onClose }: HoldingDetailModalProps) {
  const [range, setRange] = useState<TickerRange>('1y');
  const history = useTickerHistory(holding.ticker, range);
  const showNews = NEWS_INSTRUMENT_TYPES.has(holding.instrumentType);
  const holdingArray = useMemo(() => [holding], [holding]);
  const news = usePortfolioNews(showNews ? holdingArray : []);

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

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!history.data) return [];
    return history.data.points.map((p) => {
      const [year, month, day] = p.date.split('-').map(Number);
      return { date: p.date, timestamp: new Date(year, month - 1, day).getTime(), close: p.close };
    });
  }, [history.data]);

  // Change over the selected range: first close → last close of the series.
  const rangeChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].close;
    const last = chartData[chartData.length - 1].close;
    if (!(first > 0)) return null;
    return ((last - first) / first) * 100;
  }, [chartData]);

  const axes = useMemo(() => {
    if (chartData.length === 0) return null;
    return { x: buildXAxis(chartData), y: buildYAxis(chartData.map((d) => d.close)) };
  }, [chartData]);

  const perShareDayChange = holding.currentPrice - holding.previousClose;
  const dayTone = holding.dayChangePercent >= 0 ? 'positive' : 'negative';

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

  const newsEntry = news.data?.news[holding.ticker];
  const newsMarkdown =
    newsEntry?.kind === 'ai' && newsEntry.summaryMarkdown.trim() !== NO_MATERIAL_NEWS_SENTINEL
      ? newsEntry.summaryMarkdown.trim()
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      {/* Bottom sheet on mobile, centered dialog from `sm` up. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="holding-detail-title"
        className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh] overflow-y-auto bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl"
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
              <p className="font-semibold text-text-primary leading-tight">{formatPrice(holding.currentPrice)}</p>
              <p className={`text-xs ${dayTone === 'positive' ? 'text-positive' : 'text-negative'}`}>
                {perShareDayChange >= 0 ? '+' : '-'}{formatPrice(Math.abs(perShareDayChange))} ({formatPercent(holding.dayChangePercent)})
              </p>
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
            <div className="flex items-center justify-between gap-2 mb-2" style={{ paddingLeft: axes?.y.width ?? 0 }}>
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
                    <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
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
                      tick={{ fill: '#94a3b8', fontSize: AXIS_FONT_SIZE }}
                      tickFormatter={axes.y.format}
                      width={axes.y.width}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                    <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Fundamentals — the same fields the retired "i" popover showed */}
          {hasFundamentals && (
            <section>
              <SectionTitle>Fundamentals</SectionTitle>
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
          {showNews && (
            <section>
              <SectionTitle>News</SectionTitle>
              {news.isLoading ? (
                <p className="text-sm text-text-secondary">Loading news...</p>
              ) : news.error ? (
                <p className="text-sm text-text-secondary">Failed to load news</p>
              ) : newsMarkdown ? (
                <div className="text-sm text-text-primary prose prose-sm max-w-none prose-ul:my-0 prose-li:my-0.5 prose-p:my-0 prose-strong:text-text-primary prose-a:text-accent prose-a:no-underline hover:prose-a:underline marker:text-text-secondary">
                  <ReactMarkdown>{newsMarkdown}</ReactMarkdown>
                  {newsEntry?.kind === 'ai' && (
                    <p className="not-prose mt-2 text-[11px] text-text-secondary">Last updated: {newsEntry.summaryDate}</p>
                  )}
                </div>
              ) : newsEntry?.kind === 'fallback' && newsEntry.articles.length > 0 ? (
                <ul className="space-y-1">
                  {newsEntry.articles.map((a) => (
                    <li key={a.link} className="text-sm">
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-secondary">{NO_MATERIAL_NEWS_SENTINEL}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
