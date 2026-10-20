import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  usePlotArea,
} from 'recharts';
import type { HistoricalDataPoint } from '../types/portfolio';
import type { ChartView } from '../hooks/usePortfolioData';
import type { BenchmarkPoint, BenchmarkSeries } from '../hooks/useBenchmarkIntraday';
import { formatChartDate, formatChartTime, formatCurrency } from '../utils/formatters';

interface PerformanceChartProps {
  data: HistoricalDataPoint[];
  isLoading?: boolean;
  chartView: ChartView;
  onViewChange: (view: ChartView) => void;
  currentValue?: number;
  showExtendedHours?: boolean;
  // Benchmark-overlay pilot (BENCHMARK_PILOT): funds plotted by % move on the
  // 1D chart, against the portfolio's previous-close value.
  benchmarks?: BenchmarkSeries[];
  previousCloseValue?: number | null;
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  formattedDate: string;
  value: number;
  // Benchmark-overlay pilot: each fund's move mapped onto the dollar axis
  // (previousCloseValue × (1 + pct)) purely for plotting — it is only ever
  // labelled in %, never as a dollar amount.
  bench?: Record<string, number | undefined>;
}

// Validated against both card surfaces (#1e293b dark, #fff light) alongside
// the portfolio's #3b82f6 for colorblind separation; amber/magenta keep clear
// of the gain/loss green/red.
const BENCHMARK_COLORS = ['#c98500', '#d55181'];
const BENCHMARK_HOLD_MS = 5 * 60 * 1000;

// The fund's % move at time t: linear between its bars (what the drawn line
// shows anyway), held for one bar past the last one, undefined before the first.
function benchmarkPctAt(points: BenchmarkPoint[], t: number): number | undefined {
  if (points.length === 0 || t < points[0].t) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo];
  const b = points[lo + 1];
  if (!b) return t - a.t <= BENCHMARK_HOLD_MS ? a.pct : undefined;
  return a.pct + ((b.pct - a.pct) * (t - a.t)) / (b.t - a.t);
}

const formatPct = (fraction: number) => {
  const pct = Number((fraction * 100).toFixed(2));
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
};
const formatPctTick = (fraction: number) => {
  const pct = Number((fraction * 100).toFixed(2));
  return `${pct > 0 ? '+' : ''}${pct}%`;
};
const formatPts = (fraction: number) => {
  const pts = Number((fraction * 100).toFixed(2));
  return `${pts > 0 ? '+' : ''}${pts.toFixed(2)} pts`;
};

interface OverlayInfo {
  previousClose: number;
  series: { symbol: string; color: string }[];
}

interface EndLabel {
  symbol: string;
  color: string;
  timestamp: number;
  value: number;
}

// Direct labels at each fund line's last point — the overlay's only legend,
// so it costs no vertical space. Pixel positions come from the plot area and
// the chart's explicit domains (both axes are linear). Labels sit right of
// the point, flip left once it nears the plot's right edge (late session),
// and are nudged apart vertically when two ends land close together.
function BenchmarkEndLabels({ labels, xDomain, yDomain }: {
  labels: EndLabel[];
  xDomain: [number, number];
  yDomain: [number, number];
}) {
  const plot = usePlotArea();
  if (!plot || labels.length === 0) return null;
  const toX = (t: number) => plot.x + ((t - xDomain[0]) / (xDomain[1] - xDomain[0])) * plot.width;
  const toY = (v: number) => plot.y + ((yDomain[1] - v) / (yDomain[1] - yDomain[0])) * plot.height;
  const placed = labels
    .map((label) => ({ ...label, x: toX(label.timestamp), y: toY(label.value), textY: toY(label.value) }))
    .sort((a, b) => a.y - b.y);
  const MIN_GAP = 11;
  for (let i = 1; i < placed.length; i++) {
    const overlap = MIN_GAP - (placed[i].textY - placed[i - 1].textY);
    if (overlap > 0) {
      placed[i - 1].textY -= overlap / 2;
      placed[i].textY += overlap / 2;
    }
  }
  return (
    <g pointerEvents="none">
      {placed.map(({ symbol, color, x, y, textY }) => {
        const flip = x + 30 > plot.x + plot.width;
        return (
          <g key={symbol}>
            <circle cx={x} cy={y} r={2.5} fill={color} />
            <text
              x={flip ? x - 6 : x + 6}
              y={flip ? textY - 7 : textY}
              dy="0.35em"
              textAnchor={flip ? 'end' : 'start'}
              fill="#94a3b8"
              fontSize={10}
            >
              {symbol}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: ChartDataPoint }>;
  label?: number;
  overlay?: OverlayInfo | null;
}

function CustomTooltip({ active, payload, overlay }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0].payload;

  if (overlay) {
    const ownPct = dataPoint.value / overlay.previousClose - 1;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl min-w-44">
        <p className="text-text-secondary text-xs mb-1">{dataPoint.formattedDate}</p>
        <div className="flex justify-between gap-4 text-sm text-text-primary font-semibold">
          <span>{formatCurrency(dataPoint.value)}</span>
          <span className="text-text-secondary font-normal text-xs self-center">{formatPct(ownPct)}</span>
        </div>
        {overlay.series.map(({ symbol, color }) => {
          const benchValue = dataPoint.bench?.[symbol];
          if (benchValue === undefined) return null;
          const benchPct = benchValue / overlay.previousClose - 1;
          const gap = ownPct - benchPct;
          return (
            <div key={symbol} className="flex justify-between gap-4 text-xs mt-1">
              <span className="inline-flex items-center gap-1.5 text-text-primary">
                <span className="w-2.5 h-0.5 rounded-full" style={{ background: color }} />
                {symbol} {formatPct(benchPct)}
              </span>
              <span className={gap < 0 ? 'text-negative' : 'text-positive'}>you {formatPts(gap)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{dataPoint.formattedDate}</p>
      <p className="text-sm text-text-primary font-semibold">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export function PerformanceChart({ data, isLoading, chartView, onViewChange, currentValue, showExtendedHours = true, benchmarks, previousCloseValue }: PerformanceChartProps) {
  const overlayActive =
    chartView === '1D' && !!benchmarks?.length && previousCloseValue != null && previousCloseValue > 0;
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  ));
  const tickFontSize = isMobile ? 10 : 11;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  // Swipe gesture kept as a secondary affordance on mobile. The primary
  // control is the "30-Day View" row in UserMenu (TimeframeContext), which
  // drives this chart, the TotalValue headline, and the landing list
  // together. The old in-chart dots and desktop top-right toggle have been
  // removed.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      onViewChange(deltaX < 0 ? '30D' : '1D');
    }
    touchStartRef.current = null;
  };

  const chartData = useMemo(() => {
    if (data.length === 0) return [];

    let points: ChartDataPoint[];

    if (chartView === '1D') {
      // Intraday: use all data points, format as time
      points = data.map((point): ChartDataPoint => ({
        date: point.date,
        timestamp: new Date(point.date).getTime(),
        formattedDate: formatChartTime(point.date),
        value: point.value,
      }));
    } else {
      // 30D: Filter to last 30 days, format as date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const cutoffDateStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

      const filteredData = data.filter((point) => point.date >= cutoffDateStr);

      points = filteredData.map((point): ChartDataPoint => {
        // Parse date as local date components (not UTC) to avoid timezone shift
        const [year, month, day] = point.date.split('-').map(Number);
        const timestamp = new Date(year, month - 1, day).getTime();
        return {
          date: point.date,
          timestamp,
          formattedDate: formatChartDate(point.date),
          value: point.value,
        };
      });
    }

    // For 30D view, add today's point with currentValue to ensure chart ends at correct date
    if (currentValue !== undefined && Number.isFinite(currentValue) && points.length > 0 && chartView !== '1D') {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const lastPoint = points[points.length - 1];

      // Only add new point if last point is not already today
      if (lastPoint.date !== todayStr) {
        // Use local midnight for consistency with other data points
        const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        points.push({
          date: todayStr,
          timestamp: todayMidnight,
          formattedDate: formatChartDate(todayStr),
          value: currentValue,
        });
      } else {
        // Update existing today point's value
        points[points.length - 1] = {
          ...lastPoint,
          value: currentValue,
        };
      }
    }

    if (overlayActive) {
      points = points.map((point) => {
        const bench: Record<string, number | undefined> = {};
        for (const series of benchmarks!) {
          const pct = benchmarkPctAt(series.points, point.timestamp);
          bench[series.symbol] = pct === undefined ? undefined : previousCloseValue! * (1 + pct);
        }
        return { ...point, bench };
      });
    }

    return points;
  }, [data, chartView, currentValue, overlayActive, benchmarks, previousCloseValue]);

  // Pilot overlay: colors follow the fund's slot in BENCHMARK_PILOT.
  const overlaySeries = overlayActive
    ? benchmarks!.map((series, i) => ({ symbol: series.symbol, color: BENCHMARK_COLORS[i % BENCHMARK_COLORS.length] }))
    : [];

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl px-1 py-0 sm:p-6 border border-border" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="flex items-start h-48 md:h-72">
          <div className="relative flex-1 h-full min-w-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-text-secondary text-sm">Loading chart data...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-card rounded-2xl px-1 py-0 sm:p-6 border border-border" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="flex items-start h-48 md:h-72">
          <div className="relative flex-1 h-full min-w-0 flex items-center justify-center text-text-secondary">
            No data available
          </div>
        </div>
      </div>
    );
  }

  // Calculate min/max for Y axis with some padding
  const values = chartData.map((d) => d.value);
  if (overlayActive) {
    values.push(previousCloseValue!);
    for (const point of chartData) {
      for (const { symbol } of overlaySeries) {
        const v = point.bench?.[symbol];
        if (v !== undefined) values.push(v);
      }
    }
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  // 10% padding (6% on mobile, where every pixel of plot counts), or a small positive pad if flat
  const padding = range > 0 ? range * (isMobile ? 0.06 : 0.1) : Math.max(Math.abs(maxValue) * 0.05, 1);

  // Overlay: gridline ticks at round % moves from the previous close, shared
  // by both axes — the left labels them in dollars, the right in %. One scale,
  // two labelings, so a fund line above yours always means it's up more.
  let overlayTicks: number[] | undefined;
  if (overlayActive) {
    const prev = previousCloseValue!;
    const lowPct = ((minValue - padding) / prev - 1) * 100;
    const highPct = ((maxValue + padding) / prev - 1) * 100;
    // No 0.25 step: "+0.25%" would overflow the narrow mobile % axis.
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => (highPct - lowPct) / s <= 6) ?? 10;
    overlayTicks = [];
    for (let k = Math.ceil(lowPct / step); k <= Math.floor(highPct / step); k++) {
      overlayTicks.push(prev * (1 + (k * step) / 100));
    }
  }

  const endLabels: EndLabel[] = [];
  if (overlayActive) {
    for (const { symbol, color } of overlaySeries) {
      for (let i = chartData.length - 1; i >= 0; i--) {
        const value = chartData[i].bench?.[symbol];
        if (value !== undefined) {
          endLabels.push({ symbol, color, timestamp: chartData[i].timestamp, value });
          break;
        }
      }
    }
  }

  const getETOffsetIso = (date: Date): string => {
    const offsetPart = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';

    const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) return '-05:00';

    const sign = match[1];
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  };

  const getIntradaySessionBoundaries = (
    dataDate: Date
  ): { preStart: number; regularStart: number; regularEnd: number; postEnd: number } => {
    const etDateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dataDate);

    const year = etDateParts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = etDateParts.find((part) => part.type === 'month')?.value ?? '01';
    const day = etDateParts.find((part) => part.type === 'day')?.value ?? '01';
    const baseDate = `${year}-${month}-${day}`;
    const etOffset = getETOffsetIso(new Date(`${baseDate}T12:00:00Z`));

    const preStart = new Date(`${baseDate}T04:00:00${etOffset}`).getTime();
    const regularStart = new Date(`${baseDate}T09:30:00${etOffset}`).getTime();
    const regularEnd = new Date(`${baseDate}T16:00:00${etOffset}`).getTime();
    const postEnd = new Date(`${baseDate}T20:00:00${etOffset}`).getTime();

    return { preStart, regularStart, regularEnd, postEnd };
  };

  const sessionBoundaries = chartView === '1D' && chartData.length > 0
    ? getIntradaySessionBoundaries(new Date(chartData[0].timestamp))
    : null;

  const xDomain = chartView === '1D' && sessionBoundaries
    ? (showExtendedHours
        ? [sessionBoundaries.preStart, sessionBoundaries.postEnd]
        : [sessionBoundaries.regularStart, sessionBoundaries.regularEnd])
    : ['dataMin', 'dataMax'];

  return (
    <div className="bg-card rounded-2xl px-1 py-0 sm:p-6 border border-border" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-start h-48 md:h-72">
        <div className="relative flex-1 h-full min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: isMobile ? 6 : 10, right: 0, left: 0, bottom: 0 }}
              >
                {chartView === '1D' && sessionBoundaries && showExtendedHours && (
                  <>
                    <ReferenceArea
                      x1={sessionBoundaries.preStart}
                      x2={sessionBoundaries.regularStart}
                      fill="#14b8a6"
                      fillOpacity={0.14}
                      ifOverflow="visible"
                    />
                    <ReferenceArea
                      x1={sessionBoundaries.regularStart}
                      x2={sessionBoundaries.regularEnd}
                      fill="#3b82f6"
                      fillOpacity={0.07}
                      ifOverflow="visible"
                    />
                    <ReferenceArea
                      x1={sessionBoundaries.regularEnd}
                      x2={sessionBoundaries.postEnd}
                      fill="#e11d48"
                      fillOpacity={0.14}
                      ifOverflow="visible"
                    />
                  </>
                )}
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={xDomain as [number, number] | ['dataMin', 'dataMax']}
                  axisLine={false}
                  tickLine={false}
                  tickSize={0}
                  tickMargin={isMobile ? 4 : 8}
                  height={isMobile ? 20 : 30}
                  tick={{ fill: '#94a3b8', fontSize: tickFontSize }}
                  tickFormatter={(ts) => {
                    if (chartView === '1D') {
                      return formatChartTime(new Date(ts).toISOString());
                    }
                    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ts));
                  }}
                  minTickGap={50}
                />
                <YAxis
                  domain={[minValue - padding, maxValue + padding]}
                  ticks={overlayTicks}
                  axisLine={false}
                  tickLine={false}
                  // No tick marks are drawn, so give their 6px back to the
                  // label. Mobile widths fit the widest label ("$24.12M",
                  // "+0.5%") at 10px with ~2px to spare — measured, so don't
                  // trim further without re-checking for clipping.
                  tickSize={0}
                  tickMargin={3}
                  tick={{ fill: '#94a3b8', fontSize: tickFontSize }}
                  tickFormatter={(value) => {
                    if (Math.abs(value) >= 1_000_000) {
                      return `$${(value / 1_000_000).toFixed(2)}M`;
                    }
                    if (Math.abs(value) >= 1_000) {
                      return `$${(value / 1_000).toFixed(1)}k`;
                    }
                    return `$${value.toFixed(0)}`;
                  }}
                  width={isMobile ? 48 : 58}
                />
                {overlayActive && (
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    domain={[minValue - padding, maxValue + padding]}
                    ticks={overlayTicks}
                    axisLine={false}
                    tickLine={false}
                    tickSize={0}
                    tickMargin={3}
                    tick={{ fill: '#94a3b8', fontSize: tickFontSize }}
                    tickFormatter={(value: number) => formatPctTick(value / previousCloseValue! - 1)}
                    width={isMobile ? 36 : 48}
                  />
                )}
                {overlayActive && (
                  <ReferenceLine y={previousCloseValue!} stroke="#94a3b8" strokeOpacity={0.5} strokeDasharray="3 4" />
                )}
                <Tooltip content={<CustomTooltip overlay={overlayActive ? { previousClose: previousCloseValue!, series: overlaySeries } : null} />} />
                {overlaySeries.map(({ symbol, color }) => (
                  <Line
                    key={symbol}
                    // Same domain as the dollar axis; recharts only draws an
                    // axis that has a series attached.
                    yAxisId="pct"
                    type="monotone"
                    dataKey={(d: ChartDataPoint) => d.bench?.[symbol]}
                    stroke={color}
                    strokeWidth={1.5}
                    dot={false}
                    name={symbol}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Portfolio"
                />
                {overlayActive && sessionBoundaries && (
                  <BenchmarkEndLabels
                    labels={endLabels}
                    xDomain={xDomain as [number, number]}
                    yDomain={[minValue - padding, maxValue + padding]}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {chartView === '1D' && sessionBoundaries && showExtendedHours && (
            <div className="hidden md:flex items-center gap-2.5 pt-1 pl-1 text-[10px] text-text-secondary">
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
        </div>
      </div>
    </div>
  );
}
