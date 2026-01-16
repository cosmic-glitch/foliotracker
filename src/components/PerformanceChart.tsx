import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { HistoricalDataPoint, MarketStatus } from '../types/portfolio';
import type { ChartView } from '../hooks/usePortfolioData';
import { formatChartDate, formatChartTime, formatCurrency } from '../utils/formatters';

interface PerformanceChartProps {
  data: HistoricalDataPoint[];
  isLoading?: boolean;
  chartView: ChartView;
  onViewChange: (view: ChartView) => void;
  currentValue?: number;
  marketStatus?: MarketStatus;
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

export function PerformanceChart({ data, isLoading, chartView, onViewChange, currentValue, marketStatus }: PerformanceChartProps) {
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

      points = filteredData.map((point): ChartDataPoint => ({
        date: point.date,
        timestamp: new Date(point.date).getTime(),
        formattedDate: formatChartDate(point.date),
        value: point.value,
      }));
    }

    // For 30D view, add today's point with currentValue to ensure chart ends at correct date
    if (currentValue && points.length > 0 && chartView !== '1D') {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const lastPoint = points[points.length - 1];

      // Only add new point if last point is not already today
      if (lastPoint.date !== todayStr) {
        points.push({
          date: todayStr,
          timestamp: today.getTime(),
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

  const isMarketOpen = marketStatus === 'open';

  const renderHeader = () => (
    <div className="flex items-center mb-4">
      <div className="flex rounded-lg overflow-hidden border border-border">
        {isMarketOpen && (
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
        )}
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
      <div className="bg-card rounded-2xl p-6 border border-border">
        {renderHeader()}
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
        {renderHeader()}
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

  // Calculate market hours for x-axis domain (9:30 AM - 4:00 PM ET)
  const getMarketHoursDomain = (): [number, number] => {
    // Create dates in ET timezone
    const etDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const marketOpen = new Date(etDate);
    marketOpen.setHours(9, 30, 0, 0);

    const marketClose = new Date(etDate);
    marketClose.setHours(16, 0, 0, 0);

    return [marketOpen.getTime(), marketClose.getTime()];
  };

  const xDomain = chartView === '1D' ? getMarketHoursDomain() : ['dataMin', 'dataMax'];

  return (
    <div className="bg-card rounded-2xl p-6 border border-border">
      {renderHeader()}
      <div className="h-64 md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={xDomain as [number, number] | ['dataMin', 'dataMax']}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(ts) => chartView === '1D' ? formatChartTime(new Date(ts).toISOString()) : formatChartDate(new Date(ts).toISOString())}
              minTickGap={50}
            />
            <YAxis
              domain={[minValue - padding, maxValue + padding]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(value) => formatCurrency(value, true)}
              width={65}
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
  );
}
