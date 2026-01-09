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
import { formatChartDate, formatCurrency } from '../utils/formatters';

interface PerformanceChartProps {
  data: HistoricalDataPoint[];
  isLoading?: boolean;
}

interface ChartDataPoint {
  date: string;
  formattedDate: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-text-secondary text-xs mb-1">{label}</p>
      <p className="text-sm text-text-primary font-semibold">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export function PerformanceChart({ data, isLoading }: PerformanceChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return [];

    // Filter to last 30 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffDateStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

    const filteredData = data.filter((point) => point.date >= cutoffDateStr);

    return filteredData.map((point): ChartDataPoint => ({
      date: point.date,
      formattedDate: formatChartDate(point.date),
      value: point.value,
    }));
  }, [data]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Last 30 Days</h2>
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
        <h2 className="text-lg font-semibold text-text-primary mb-4">Last 30 Days</h2>
        <div className="h-64 flex items-center justify-center text-text-secondary">
          No historical data available
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

  return (
    <div className="bg-card rounded-2xl p-6 border border-border">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Last 30 Days</h2>
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
