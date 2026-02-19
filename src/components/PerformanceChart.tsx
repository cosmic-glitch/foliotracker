import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { HistoricalDataPoint } from '../types/portfolio';
import type { ChartView } from '../hooks/usePortfolioData';
import { formatChartDate, formatChartTime, formatCurrency } from '../utils/formatters';

interface PerformanceChartProps {
  data: HistoricalDataPoint[];
  isLoading?: boolean;
  chartView: ChartView;
  onViewChange: (view: ChartView) => void;
  currentValue?: number;
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  formattedDate: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: ChartDataPoint }>;
  label?: number;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0].payload;

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{dataPoint.formattedDate}</p>
      <p className="text-sm text-text-primary font-semibold">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export function PerformanceChart({ data, isLoading, chartView, onViewChange, currentValue }: PerformanceChartProps) {
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
    if (currentValue && points.length > 0 && chartView !== '1D') {
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

    return points;
  }, [data, chartView, currentValue]);

  const renderToggle = (overlay = false) => (
    <div className={overlay ? "absolute top-0 right-0 z-10" : "mb-4"}>
      <div className={`flex rounded-lg overflow-hidden border border-border ${overlay ? 'bg-card/80 backdrop-blur-sm' : ''}`}>
        <button
          onClick={() => onViewChange('1D')}
          className={`px-3 py-1 text-sm font-medium transition-colors ${
            chartView === '1D'
              ? 'bg-accent text-white'
              : 'bg-card text-text-secondary hover:bg-background'
          }`}
        >
          1D
        </button>
        <button
          onClick={() => onViewChange('30D')}
          className={`px-3 py-1 text-sm font-medium transition-colors ${
            chartView === '30D'
              ? 'bg-accent text-white'
              : 'bg-card text-text-secondary hover:bg-background'
          }`}
        >
          30D
        </button>
      </div>
    </div>
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl p-3 sm:p-6 border border-border">
        {renderToggle()}
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
      <div className="bg-card rounded-2xl p-3 sm:p-6 border border-border">
        {renderToggle()}
        <div className="h-64 flex items-center justify-center text-text-secondary">
          No data available
        </div>
      </div>
    );
  }

  // Calculate min/max for Y axis with some padding
  const values = chartData.map((d) => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const padding = range * 0.1 || maxValue * 0.05; // 10% padding, or 5% of max if flat

  // Helper to get ET offset string (-05:00 for EST or -04:00 for EDT)
  const getETOffset = (date: Date): string => {
    const etTime = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const utcTime = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const diffHours = (new Date(etTime).getTime() - new Date(utcTime).getTime()) / 3600000;
    return diffHours >= -4 ? '-04:00' : '-05:00';
  };

  // Calculate market hours for x-axis domain (9:30 AM - 4:00 PM ET)
  const getMarketHoursDomain = (dataDate: Date): [number, number] => {
    // Get date string in ET for the given data timestamp
    const etDateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dataDate);

    const year = etDateParts.find(p => p.type === 'year')!.value;
    const month = etDateParts.find(p => p.type === 'month')!.value;
    const day = etDateParts.find(p => p.type === 'day')!.value;
    const baseDate = `${year}-${month}-${day}`;

    // Get ET offset for this date (handles DST automatically)
    const etOffset = getETOffset(new Date(`${baseDate}T12:00:00`));

    // Create market open (9:30 AM ET) and close (4:00 PM ET) timestamps
    const marketOpen = new Date(`${baseDate}T09:30:00${etOffset}`);
    const marketClose = new Date(`${baseDate}T16:00:00${etOffset}`);

    return [marketOpen.getTime(), marketClose.getTime()];
  };

  const xDomain = chartView === '1D' && chartData.length > 0
    ? getMarketHoursDomain(new Date(chartData[0].timestamp))
    : ['dataMin', 'dataMax'];

  return (
    <div className="bg-card rounded-2xl p-3 sm:p-6 border border-border">
      <div className="relative">
        {renderToggle(true)}
        <div className="h-64 md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={xDomain as [number, number] | ['dataMin', 'dataMax']}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
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
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={(value) => formatCurrency(value, true)}
                width={58}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Portfolio"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
