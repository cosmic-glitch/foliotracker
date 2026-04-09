import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { formatCurrency, formatChange, formatPercent } from '../utils/formatters';

const COUNT_DURATION_MS = 900;
const HOLD_DURATION_MS = 3000;

interface TotalValueProps {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalGain: number | null;
  totalGainPercent: number | null;
  peakPotentialValue: number;
}

// Animates the displayed value toward `target` using ease-out cubic.
// Restarts whenever `target` changes, beginning from whatever value is
// currently on screen (so mid-animation retargets look smooth).
function useCountUp(target: number, duration: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  });

  useEffect(() => {
    let rafId = 0;
    const startValue = valueRef.current;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(startValue + (target - startValue) * eased);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);

  return value;
}

type RevealPhase = 'idle' | 'up' | 'hold' | 'down';

export function TotalValue({
  totalValue,
  dayChange,
  dayChangePercent,
  totalGain,
  totalGainPercent,
  peakPotentialValue,
}: TotalValueProps) {
  const isPositive = dayChange >= 0;
  const DayIcon = isPositive ? TrendingUp : TrendingDown;
  const dayChangeColor = isPositive ? 'text-positive' : 'text-negative';
  const dayBgColor = isPositive ? 'bg-positive/10' : 'bg-negative/10';

  const gainIsPositive = totalGain !== null ? totalGain >= 0 : true;
  const GainIcon = gainIsPositive ? TrendingUp : TrendingDown;
  const gainColor = gainIsPositive ? 'text-positive' : 'text-negative';
  const gainBgColor = gainIsPositive ? 'bg-positive/10' : 'bg-negative/10';

  // 52-week-high "peak potential" easter egg:
  // idle → up (count up) → hold (3s) → down (count back) → idle
  const [phase, setPhase] = useState<RevealPhase>('idle');
  const target = phase === 'up' || phase === 'hold' ? peakPotentialValue : totalValue;
  const animatedValue = useCountUp(target, COUNT_DURATION_MS);
  const isRevealing = phase !== 'idle';

  const triggerReveal = () => {
    if (phase !== 'idle') return;
    if (peakPotentialValue <= totalValue) return;
    setPhase('up');
  };

  useEffect(() => {
    if (phase === 'idle') return;
    let timeoutId: number;
    if (phase === 'up') {
      timeoutId = window.setTimeout(() => setPhase('hold'), COUNT_DURATION_MS);
    } else if (phase === 'hold') {
      timeoutId = window.setTimeout(() => setPhase('down'), HOLD_DURATION_MS);
    } else {
      timeoutId = window.setTimeout(() => setPhase('idle'), COUNT_DURATION_MS);
    }
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  const peakDelta = peakPotentialValue - totalValue;

  return (
    <div className="bg-card rounded-2xl px-2.5 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 border border-border">
      <div className="flex flex-row items-stretch justify-between gap-2 md:gap-4">
        <div
          className="min-w-0 flex-shrink flex items-center cursor-pointer select-none"
          onClick={triggerReveal}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              triggerReveal();
            }
          }}
        >
          <p className="text-2xl md:text-5xl font-bold text-text-primary tracking-tight">
            {formatCurrency(animatedValue)}
          </p>
        </div>
        {!isRevealing ? (
          <div className="flex flex-row items-stretch gap-1.5 sm:gap-2 md:gap-3">
            <div className={`flex items-center gap-1 sm:gap-1.5 md:gap-3 px-1.5 py-1 sm:px-2.5 sm:py-1.5 md:px-4 md:py-3 rounded-xl ${dayBgColor}`}>
              <DayIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-5 md:h-5 ${dayChangeColor}`} />
              <div className="flex flex-col">
                <span className={`text-xs sm:text-sm md:text-lg font-semibold ${dayChangeColor}`}>
                  {formatChange(dayChange, true)}
                </span>
                <span className={`text-[10px] sm:text-[11px] md:text-sm ${dayChangeColor}`}>
                  {formatPercent(dayChangePercent)} today
                </span>
              </div>
            </div>
            {totalGain !== null && totalGainPercent !== null && (
                <div className={`flex items-center gap-1 sm:gap-1.5 md:gap-3 px-1.5 py-1 sm:px-2.5 sm:py-1.5 md:px-4 md:py-3 rounded-xl ${gainBgColor}`}>
                  <GainIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-5 md:h-5 ${gainColor}`} />
                  <div className="flex flex-col">
                    <span className={`text-xs sm:text-sm md:text-lg font-semibold ${gainColor}`}>
                      {formatChange(totalGain, true)}
                    </span>
                    <span className={`text-[10px] sm:text-[11px] md:text-sm ${gainColor}`}>
                      unrealized gain
                    </span>
                  </div>
                </div>
            )}
          </div>
        ) : (
          <div className="flex flex-row items-stretch animate-[fadeIn_0.2s_ease-out]">
            <div className="flex items-center gap-1 sm:gap-1.5 md:gap-3 px-1.5 py-1 sm:px-2.5 sm:py-1.5 md:px-4 md:py-3 rounded-xl bg-accent/10">
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-5 md:h-5 text-accent" />
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm md:text-lg font-semibold text-accent">
                  {formatChange(peakDelta, true)}
                </span>
                <span className="text-[10px] sm:text-[11px] md:text-sm text-accent">
                  if all hit 52w high
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
