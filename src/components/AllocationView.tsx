import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { Holding } from '../types/portfolio';
import { consolidateHoldings } from '../utils/equivalentTickers';
import { HoldingsByType } from './HoldingsByType';
import { AllocationBar } from './AllocationBar';

const PIE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4'];
const RADIAN = Math.PI / 180;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  if (percent < 0.03) return null;
  const radius = outerRadius * 1.25;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="var(--color-text-secondary)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
    >
      {payload.ticker} {(percent * 100).toFixed(1)}%
    </text>
  );
}

interface PieTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { ticker: string; allocation: number } }>;
}

function PieTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const { ticker, allocation } = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm text-text-primary font-semibold">{ticker}</p>
      <p className="text-text-secondary text-xs">{allocation.toFixed(1)}%</p>
    </div>
  );
}

interface AllocationViewProps {
  holdings: Holding[];
}

export function AllocationView({ holdings }: AllocationViewProps) {
  const [viewMode, setViewMode] = useState<'bar' | 'pie'>('bar');
  const consolidatedHoldings = useMemo(() => consolidateHoldings(holdings), [holdings]);
  // Sort purely by value for allocation view (no static/non-static grouping)
  const byValue = useMemo(() => [...consolidatedHoldings].sort((a, b) => b.value - a.value), [consolidatedHoldings]);
  const maxAllocation = Math.max(...byValue.map((h) => h.allocation));
  const maxTickerLength = Math.max(...byValue.map((h) => h.ticker.length));

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">By Holding</h2>
          <button
            onClick={() => setViewMode(viewMode === 'bar' ? 'pie' : 'bar')}
            className="text-xs text-text-secondary hover:text-text-primary underline transition-colors"
          >
            Switch to {viewMode === 'bar' ? 'Pie Chart' : 'Bar Chart'}
          </button>
        </div>
        {viewMode === 'bar' ? (
          <div className="p-3 space-y-0.5">
            {byValue.map((holding) => (
              <div key={holding.ticker} className="flex items-center gap-1.5 px-1">
                <span className="font-medium text-text-primary text-sm shrink-0 whitespace-nowrap" style={{ minWidth: `${maxTickerLength}ch` }}>{holding.ticker}</span>
                <div className="flex-1 min-w-0">
                  <AllocationBar percent={holding.allocation} maxPercent={maxAllocation} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart margin={{ top: 20, right: 60, bottom: 20, left: 60 }}>
                <Pie
                  data={byValue.map(h => ({ ticker: h.ticker, allocation: h.allocation }))}
                  dataKey="allocation"
                  nameKey="ticker"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  label={renderPieLabel}
                  labelLine={false}
                >
                  {byValue.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <HoldingsByType holdings={holdings} />
    </div>
  );
}
