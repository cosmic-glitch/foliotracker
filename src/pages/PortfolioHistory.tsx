import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { usePortfolioHistory, type HistoryDay } from '../hooks/usePortfolioHistory';
import { useUnlockedPortfolios } from '../hooks/useUnlockedPortfolios';
import { useLoggedInPortfolio } from '../hooks/useLoggedInPortfolio';
import { useTheme } from '../context/ThemeContext';
import { formatCurrency, formatChange, formatPercent } from '../utils/formatters';
import { canonicalTicker } from '../utils/equivalentTickers';
import { TYPE_CATEGORY_MAP } from '../utils/instrumentTypes';

// ── Ranges ────────────────────────────────────────────────────────────────
type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';
const RANGES: Array<{ key: RangeKey; label: string; months?: number }> = [
  { key: '1M', label: '1M', months: 1 },
  { key: '3M', label: '3M', months: 3 },
  { key: '6M', label: '6M', months: 6 },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y', months: 12 },
  { key: 'ALL', label: 'All' },
];

function rangeStart(key: RangeKey, lastDate: string): string | null {
  if (key === 'ALL') return null;
  if (key === 'YTD') return `${lastDate.slice(0, 4)}-01-01`;
  const months = RANGES.find((r) => r.key === key)!.months!;
  const d = new Date(`${lastDate}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// A stretch longer than this between consecutive days is a hole in the data
// (no holdings known), not a weekend/holiday — charts break the line there.
const GAP_DAYS = 7;
const DAY_MS = 86_400_000;

const toTs = (date: string) => new Date(`${date}T12:00:00Z`).getTime();
const shortDate = (ts: number) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ts));
// X-axis ticks: month starts for spans over ~4 months (labelled "Mar", with
// the year on January / the first tick), otherwise recharts' own day ticks.
function monthTicks(minTs: number, maxTs: number): number[] | undefined {
  if ((maxTs - minTs) / DAY_MS <= 120) return undefined;
  const ticks: number[] = [];
  const d = new Date(minTs);
  d.setUTCDate(1);
  d.setUTCHours(12, 0, 0, 0);
  for (d.setUTCMonth(d.getUTCMonth() + 1); d.getTime() <= maxTs; d.setUTCMonth(d.getUTCMonth() + 1)) {
    ticks.push(d.getTime());
  }
  const step = Math.ceil(ticks.length / 8);
  return ticks.filter((_, i) => i % step === 0);
}
const axisDate = (ts: number, ticks: number[] | undefined) => {
  const d = new Date(ts);
  if (!ticks) return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  return d.getUTCMonth() === 0 || ts === ticks[0] ? `${month} '${String(d.getUTCFullYear()).slice(2)}` : month;
};
const longDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));

function compactAxisCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

// ── Allocation series ────────────────────────────────────────────────────
type AllocationMode = 'type' | 'holdings';
const TOP_HOLDINGS = 7;
const OTHER_COLOR = '#6b7280';
// Reference categorical palette (dataviz skill), fixed order, light/dark steps.
const HOLDING_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
};

interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

// Holdings → { seriesKey: weight } over gross (positive) assets. Liabilities
// can't be a slice of a 100% stack, so they're left out and flagged.
function weightsFor(day: HistoryDay, keyOf: (h: HistoryDay['holdings'][number]) => string): Map<string, number> {
  const out = new Map<string, number>();
  let gross = 0;
  for (const h of day.holdings) {
    if (h.weight <= 0) continue;
    gross += h.weight;
    const k = keyOf(h);
    out.set(k, (out.get(k) ?? 0) + h.weight);
  }
  if (gross > 0) for (const [k, v] of out) out.set(k, (v / gross) * 100);
  return out;
}

const holdingKey = (h: HistoryDay['holdings'][number]) => (h.isStatic ? `static:${h.name}` : canonicalTicker(h.ticker));
const holdingLabel = (h: HistoryDay['holdings'][number]) => (h.isStatic ? h.name : canonicalTicker(h.ticker));
const typeName = (instrumentType: string) => (TYPE_CATEGORY_MAP[instrumentType] ?? TYPE_CATEGORY_MAP.Other).name;

// ── Page ─────────────────────────────────────────────────────────────────
export function PortfolioHistory() {
  const { portfolioId = '' } = useParams<{ portfolioId: string }>();
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get('share');
  const { getToken } = useUnlockedPortfolios();
  const { loggedInAs, logout, getToken: getLoginToken } = useLoggedInPortfolio();
  const navigate = useNavigate();
  const storedToken = portfolioId
    ? (getToken(portfolioId) || (loggedInAs === portfolioId.toLowerCase() ? getLoginToken() : null))
    : null;
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { data, isLoading, error, dataUpdatedAt } = usePortfolioHistory(portfolioId, storedToken, loggedInAs, shareToken);
  const [range, setRange] = useState<RangeKey>('ALL');
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('holdings');

  const allDays = useMemo(() => data?.days ?? [], [data]);
  const lastDate = allDays.length ? allDays[allDays.length - 1].date : null;
  const firstDate = allDays.length ? allDays[0].date : null;

  // Only offer ranges shorter than the data (plus All).
  const availableRanges = RANGES.filter((r) => {
    if (r.key === 'ALL' || !lastDate || !firstDate) return true;
    return rangeStart(r.key, lastDate)! > firstDate;
  });
  const activeRange = availableRanges.some((r) => r.key === range) ? range : 'ALL';

  const days = useMemo(() => {
    if (!lastDate) return [];
    const start = rangeStart(activeRange, lastDate);
    return start ? allDays.filter((d) => d.date >= start) : allDays;
  }, [allDays, activeRange, lastDate]);

  const portfolioHref = `/${portfolioId}${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        portfolioId={portfolioId}
        portfolioHref={portfolioHref}
        pageTitle="History"
        loggedInAs={loggedInAs}
        onLogout={() => { logout(); navigate('/'); }}
      />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-3 md:py-6 space-y-4 md:space-y-6">
        {/* The page title lives in the Header breadcrumb (AV › History). */}
        <div className="flex">
          {allDays.length > 0 && (
            <div className="flex gap-1 bg-card border border-border rounded-lg p-1" role="group" aria-label="Date range">
              {availableRanges.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  aria-pressed={activeRange === r.key}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeRange === r.key ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-80 bg-card rounded-2xl border border-border animate-pulse" />
            <div className="h-72 bg-card rounded-2xl border border-border animate-pulse" />
          </div>
        ) : error ? (
          <div className="bg-accent/10 border border-accent/20 rounded-lg px-4 py-3 text-accent text-sm">
            {(error as Error).message}
          </div>
        ) : allDays.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border p-8 text-center text-text-secondary text-sm">
            No history yet. Values are recorded after each market close.
          </div>
        ) : (
          <>
            {data?.allocationOnly ? (
              <div className="px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-sm">
                You can see allocation history only — dollar values are hidden.
              </div>
            ) : (
              <ValueHistory days={days} />
            )}
            <AllocationHistory
              days={days}
              allDays={allDays}
              mode={allocationMode}
              onModeChange={setAllocationMode}
              isDark={isDark}
            />
            {!data?.allocationOnly && <MonthlyTable days={days} />}
            <Methodology days={allDays} />
          </>
        )}
      </main>
      <Footer lastUpdated={new Date(dataUpdatedAt)} />
    </div>
  );
}

// ── Value chart ──────────────────────────────────────────────────────────
interface ValuePoint {
  ts: number;
  date: string | null;
  value: number | null;
}

// Bridge series (`bridge0`, `bridge1`, …) live as extra keys on the points.
function setBridge(p: ValuePoint, key: string, v: number | null) {
  (p as unknown as Record<string, number | null>)[key] = v;
}

function ValueHistory({ days }: { days: HistoryDay[] }) {
  const { points, bridgeKeys, min, max } = useMemo(() => {
    const pts: ValuePoint[] = [];
    const bridges: string[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    days.forEach((d, i) => {
      const v = d.totalValue ?? 0;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      const prev = days[i - 1];
      if (prev && toTs(d.date) - toTs(prev.date) > GAP_DAYS * DAY_MS) {
        // Break both lines, and draw a dotted bridge across the hole.
        const key = `bridge${bridges.length}`;
        bridges.push(key);
        setBridge(pts[pts.length - 1], key, prev.totalValue);
        pts.push({ ts: (toTs(prev.date) + toTs(d.date)) / 2, date: null, value: null });
        const point: ValuePoint = { ts: toTs(d.date), date: d.date, value: v };
        setBridge(point, key, v);
        pts.push(point);
      } else {
        pts.push({ ts: toTs(d.date), date: d.date, value: v });
      }
    });
    return { points: pts, bridgeKeys: bridges, min: lo, max: hi };
  }, [days]);

  const first = days[0];
  const last = days[days.length - 1];
  const change = (last.totalValue ?? 0) - (first.totalValue ?? 0);
  const changePct = first.totalValue ? (change / first.totalValue) * 100 : 0;
  const pad = max > min ? (max - min) * 0.08 : Math.max(Math.abs(max) * 0.05, 1);
  const xTicks = monthTicks(toTs(first.date), toTs(last.date));
  const changeColor = change >= 0 ? 'text-positive' : 'text-negative';

  return (
    <section className="bg-card rounded-2xl border border-border p-3 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <p className="text-2xl md:text-3xl font-semibold text-text-primary tabular-nums">{formatCurrency(last.totalValue ?? 0)}</p>
        <div className="sm:text-right">
          <p className="text-xs text-text-secondary">Since {shortDate(toTs(first.date))}, {first.date.slice(0, 4)}</p>
          <p className={`text-base font-semibold tabular-nums ${changeColor}`}>
            {formatChange(change)} <span className="text-sm">({formatPercent(changePct)})</span>
          </p>
        </div>
      </div>
      <div className="h-56 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              ticks={xTicks}
              tickFormatter={(ts) => axisDate(ts, xTicks)}
              minTickGap={xTicks ? 8 : 40}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={compactAxisCurrency}
              width={58}
            />
            <Tooltip content={<ValueTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }} />
            {bridgeKeys.map((k) => (
              <Line key={k} dataKey={k} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 4" dot={false} connectNulls isAnimationActive={false} activeDot={false} />
            ))}
            <Line dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {bridgeKeys.length > 0 && (
        <div className="mt-2 text-[11px] text-text-secondary inline-flex items-center gap-1.5">
          <svg width="18" height="4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2 3" /></svg>
          No data
        </div>
      )}
    </section>
  );
}

function ValueTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ValuePoint }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p || p.date == null || p.value == null) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{longDate(p.date)}</p>
      <p className="text-sm text-text-primary font-semibold tabular-nums">{formatCurrency(p.value)}</p>
    </div>
  );
}

// ── Allocation chart ─────────────────────────────────────────────────────
function AllocationHistory({
  days,
  allDays,
  mode,
  onModeChange,
  isDark,
}: {
  days: HistoryDay[];
  allDays: HistoryDay[];
  mode: AllocationMode;
  onModeChange: (m: AllocationMode) => void;
  isDark: boolean;
}) {
  // Series identity is fixed off the latest day of ALL data (not the visible
  // range), so switching ranges never repaints a holding.
  const series: SeriesDef[] = useMemo(() => {
    const latest = allDays[allDays.length - 1];
    if (mode === 'type') {
      const w = weightsFor(latest, (h) => typeName(h.instrumentType));
      // Types present anywhere in the data, ordered by latest weight.
      const names = new Set<string>();
      for (const d of allDays) for (const h of d.holdings) if (h.weight > 0) names.add(typeName(h.instrumentType));
      return [...names]
        .sort((a, b) => (w.get(b) ?? 0) - (w.get(a) ?? 0))
        .map((name) => ({
          key: name,
          label: name,
          color: Object.values(TYPE_CATEGORY_MAP).find((t) => t.name === name)?.color ?? OTHER_COLOR,
        }));
    }
    const labels = new Map(latest.holdings.map((h) => [holdingKey(h), holdingLabel(h)]));
    const w = weightsFor(latest, holdingKey);
    const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_HOLDINGS).map(([k]) => k);
    const palette = isDark ? HOLDING_COLORS.dark : HOLDING_COLORS.light;
    return [
      ...top.map((k, i) => ({ key: k, label: labels.get(k) ?? k, color: palette[i] })),
      { key: '__other', label: 'Other', color: OTHER_COLOR },
    ];
  }, [allDays, mode, isDark]);

  const rows = useMemo(() => {
    const keys = new Set(series.map((s) => s.key));
    const out: Array<Record<string, number | string | null>> = [];
    days.forEach((d, i) => {
      const prev = days[i - 1];
      if (prev && toTs(d.date) - toTs(prev.date) > GAP_DAYS * DAY_MS) {
        // Null row breaks the stacked areas across the hole.
        const gapRow: Record<string, number | string | null> = { ts: (toTs(prev.date) + toTs(d.date)) / 2, date: null };
        for (const s of series) gapRow[s.key] = null;
        out.push(gapRow);
      }
      const w = mode === 'type'
        ? weightsFor(d, (h) => typeName(h.instrumentType))
        : weightsFor(d, (h) => (keys.has(holdingKey(h)) ? holdingKey(h) : '__other'));
      const row: Record<string, number | string | null> = { ts: toTs(d.date), date: d.date };
      for (const s of series) row[s.key] = w.get(s.key) ?? 0;
      out.push(row);
    });
    return out;
  }, [days, series, mode]);

  const hasLiabilities = days.some((d) => d.holdings.some((h) => h.weight < 0));
  const latestRow = [...rows].reverse().find((r) => r.date != null);
  const visibleSeries = series.filter((s) => rows.some((r) => ((r[s.key] as number | null) ?? 0) > 0.05));
  const xTicks = days.length ? monthTicks(toTs(days[0].date), toTs(days[days.length - 1].date)) : undefined;
  const surface = isDark ? '#1e293b' : '#ffffff';

  return (
    <section className="bg-card rounded-2xl border border-border p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Allocation over time</h3>
        <div className="flex gap-1 bg-background border border-border rounded-lg p-0.5" role="group" aria-label="Group allocation by">
          {(['holdings', 'type'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === m ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m === 'type' ? 'By type' : 'Top holdings'}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56 md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              ticks={xTicks}
              tickFormatter={(ts) => axisDate(ts, xTicks)}
              minTickGap={xTicks ? 8 : 40}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
              width={58}
            />
            <Tooltip content={<AllocationTooltip series={visibleSeries} />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }} />
            {visibleSeries.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                stackId="alloc"
                type="linear"
                stroke={surface}
                strokeWidth={1}
                fill={s.color}
                fillOpacity={0.9}
                isAnimationActive={false}
                activeDot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
        {visibleSeries.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="text-text-primary">{s.label}</span>
            <span className="text-text-secondary tabular-nums">{(((latestRow?.[s.key] as number | null) ?? 0)).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
      {hasLiabilities && (
        <p className="text-[11px] text-text-secondary mt-2">Liabilities are excluded; shares are of total assets.</p>
      )}
    </section>
  );
}

function AllocationTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, number | string | null> }>;
  series: SeriesDef[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row || row.date == null) return null;
  const items = series
    .map((s) => ({ ...s, pct: (row[s.key] as number | null) ?? 0 }))
    .filter((s) => s.pct > 0.05)
    .sort((a, b) => b.pct - a.pct);
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl min-w-40">
      <p className="text-text-secondary text-xs mb-1.5">{longDate(row.date as string)}</p>
      <ul className="space-y-0.5">
        {items.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 text-text-primary">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="text-text-secondary tabular-nums">{s.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Month-end table (the chart's table view) ─────────────────────────────
function MonthlyTable({ days }: { days: HistoryDay[] }) {
  const rows = useMemo(() => {
    const monthEnds: HistoryDay[] = [];
    days.forEach((d, i) => {
      const next = days[i + 1];
      if (!next || next.date.slice(0, 7) !== d.date.slice(0, 7)) monthEnds.push(d);
    });
    return monthEnds
      .map((d, i) => {
        const prev = monthEnds[i - 1];
        // Change only between adjacent months with data; across a hole it'd
        // span an unknown stretch.
        const adjacent = prev && toTs(d.date) - toTs(prev.date) < 45 * DAY_MS;
        const change = adjacent ? (d.totalValue ?? 0) - (prev.totalValue ?? 0) : null;
        const pct = adjacent && prev.totalValue ? (change! / prev.totalValue) * 100 : null;
        return { day: d, change, pct };
      })
      .reverse();
  }, [days]);

  if (rows.length < 2) return null;
  return (
    <section className="bg-card rounded-2xl border border-border overflow-hidden">
      <h3 className="text-sm font-semibold text-text-primary px-3 sm:px-6 pt-4 pb-2">Month-end values</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-secondary border-b border-border">
            <th className="text-left font-medium px-3 sm:px-6 py-2">Month</th>
            <th className="text-right font-medium px-3 py-2">Value</th>
            <th className="text-right font-medium px-3 sm:px-6 py-2">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ day, change, pct }) => (
            <tr key={day.date} className="border-b border-border last:border-0">
              <td className="px-3 sm:px-6 py-2 text-text-primary">
                {new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary">{formatCurrency(day.totalValue ?? 0)}</td>
              <td className={`px-3 sm:px-6 py-2 text-right tabular-nums ${change == null ? 'text-text-secondary' : change >= 0 ? 'text-positive' : 'text-negative'}`}>
                {change == null ? '—' : (
                  <>
                    {formatChange(change, true)} <span className="text-xs">({formatPercent(pct ?? 0)})</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── How it's built ───────────────────────────────────────────────────────
function Methodology({ days }: { days: HistoryDay[] }) {
  const firstRecorded = days.find((d) => d.source === 'recorded');
  // Estimated days (holdings carried between backups) aren't marked on the
  // charts — measured drift between backups is ≤ ~2%, about a day's move —
  // so the footnote just dates where they end.
  const lastEstimatedIdx = days.map((d) => d.source).lastIndexOf('estimated');
  const precise = lastEstimatedIdx >= 0 ? days[lastEstimatedIdx + 1] : undefined;
  return (
    <p className="text-xs text-text-secondary leading-relaxed">
      {firstRecorded
        ? <>Recorded after every market close since {longDate(firstRecorded.date)}. </>
        : <>Daily recording starts after the next market close. </>}
      Earlier days were rebuilt from database backups and the holdings change log at each day&rsquo;s closing
      prices{precise ? <>; values before {longDate(precise.date)} may be off by 1&ndash;2%</> : null}. Changes in value
      include money added or withdrawn, not just market moves.
    </p>
  );
}
