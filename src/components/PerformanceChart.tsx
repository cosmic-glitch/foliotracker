import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { HistoricalDataPoint, BenchmarkHistoryPoint } from '../types/portfolio';
import { type TimeRange, TIME_RANGE_DAYS } from '../hooks/usePortfolioData';
import { formatChartDate } from '../utils/formatters';

const TIME_RANGES: TimeRange[] = ['1M', '3M', '6M', '1Y', '2Y', '3Y'];

interface PerformanceChartProps {
  data: HistoricalDataPoint[];
  benchmarkData: BenchmarkHistoryPoint[];
  isLoading?: boolean;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

interface ChartDataPoint {
  date: string;
  formattedDate: string;
  portfolio: number;
  benchmark: number | null;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-2">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.dataKey === 'portfolio' ? 'Portfolio' : 'S&P 500'}:{' '}
          <span className="font-semibold">
            {entry.value >= 0 ? '+' : ''}
            {entry.value.toFixed(2)}%
          </span>
        </p>
      ))}
    </div>
  );
}

export function PerformanceChart({ data, benchmarkData, isLoading, timeRange, onTimeRangeChange }: PerformanceChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return [];

    // Filter data based on selected time range using actual dates, not point count
    const days = TIME_RANGE_DAYS[timeRange];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    // Use local date (not UTC) to avoid timezone issues
    const cutoffDateStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

    const filteredData = data.filter((point) => point.date >= cutoffDateStr);

    if (filteredData.length === 0) return [];

    // Calculate portfolio % change from first day of filtered range
    const startValue = filteredData[0].value;

    // Create a map of benchmark data by date
    const benchmarkMap = new Map<string, number>();
    // Also filter benchmark data by date and recalculate from start of range
    const filteredBenchmark = benchmarkData.filter((point) => point.date >= cutoffDateStr);
    const benchmarkStartChange = filteredBenchmark[0]?.percentChange ?? 0;
    // Convert start percent to multiplier (e.g., 53.5% -> 1.535)
    const startMultiplier = 1 + benchmarkStartChange / 100;
    for (const point of filteredBenchmark) {
      // Calculate proper compound return from the start of the filtered range
      // If start was +53.5% and current is +78.4% (both relative to original base),
      // actual return = (1.784 / 1.535 - 1) * 100 = 16.2%
      const currentMultiplier = 1 + point.percentChange / 100;
      benchmarkMap.set(point.date, (currentMultiplier / startMultiplier - 1) * 100);
    }

    return filteredData.map((point): ChartDataPoint => ({
      date: point.date,
      formattedDate: formatChartDate(point.date),
      portfolio: ((point.value - startValue) / startValue) * 100,
      benchmark: benchmarkMap.get(point.date) ?? null,
    }));
  }, [data, benchmarkData, timeRange]);

  // Time range selector buttons
  const TimeRangeButtons = () => (
    <div className="flex gap-1">
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          onClick={() => onTimeRangeChange(range)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            timeRange === range
              ? 'bg-accent text-white'
              : 'bg-card-hover text-text-secondary hover:text-text-primary'
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Performance</h2>
          <TimeRangeButtons />
        </div>
        <div className="h-64 md:h-72 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-text-secondary text-sm">Loading chart data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-card rounded-2xl p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Performance</h2>
          <TimeRangeButtons />
        </div>
        <div className="h-64 flex items-center justify-center text-text-secondary">
          No historical data available
        </div>
      </div>
    );
  }

  // Calculate min/max for Y axis
  const allValues = chartData.flatMap((d) => [d.portfolio, d.benchmark].filter((v): v is number => v !== null));
  const minValue = Math.min(...allValues, 0);
  const maxValue = Math.max(...allValues, 0);
  const padding = Math.max((maxValue - minValue) * 0.15, 1);

  // Get final values for legend (find last non-null values)
  const lastPoint = chartData[chartData.length - 1];
  const portfolioChange = lastPoint?.portfolio ?? 0;
  // Find the last non-null benchmark value (dates may not align perfectly)
  let benchmarkChange = 0;
  for (let i = chartData.length - 1; i >= 0; i--) {
    const bm = chartData[i].benchmark;
    if (bm !== null) {
      benchmarkChange = bm;
      break;
    }
  }

  return (
    <div className="bg-card rounded-2xl p-6 border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-text-primary">Performance</h2>
          <TimeRangeButtons />
        </div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-blue-500 rounded" />
            <span className="text-text-secondary">Portfolio</span>
            <span className={`font-medium ${portfolioChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {portfolioChange >= 0 ? '+' : ''}{portfolioChange.toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-purple-500 rounded" />
            <span className="text-text-secondary">S&P 500</span>
            <span className={`font-medium ${benchmarkChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {benchmarkChange >= 0 ? '+' : ''}{benchmarkChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
      <div className="h-64 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="formattedDate"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              domain={[minValue - padding, maxValue + padding]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`}
              width={55}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="portfolio"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Portfolio"
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
              name="S&P 500"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-amber-500">
        Historical performance is calculated assuming your current holdings remained unchanged during the selected time range. For meaningful results, select a period where you made no changes to your portfolio.
      </p>
    </div>
  );
}
