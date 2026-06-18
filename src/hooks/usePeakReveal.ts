import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

export const COUNT_DURATION_MS = 900;
const HOLD_DURATION_MS = 3000;

// Animates the displayed value toward `target` using ease-out cubic.
// Restarts whenever `target` changes, beginning from whatever value is
// currently on screen (so mid-animation retargets look smooth). On first
// mount it starts AT `target` (no count-from-zero) — the tween only fires when
// `target` later changes, e.g. a price refetch. The landing leaderboard uses
// it standalone (no peak-reveal state machine) to count each row's total to
// its fresh figure when prices refresh; see usePeakReveal for the detail-page
// 52-week-peak easter egg built on top of it.
export function useCountUp(target: number, duration: number = COUNT_DURATION_MS): number {
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

export interface PeakReveal {
  animatedValue: number;
  isRevealing: boolean;
  peakDelta: number;
  triggerReveal: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * "52-week-high peak potential" easter egg state machine.
 * idle → up (count up) → hold (3s) → down (count back) → idle.
 * No-op if peakPotentialValue <= totalValue.
 */
export function usePeakReveal(totalValue: number, peakPotentialValue: number): PeakReveal {
  const [phase, setPhase] = useState<RevealPhase>('idle');
  const target = phase === 'up' || phase === 'hold' ? peakPotentialValue : totalValue;
  const animatedValue = useCountUp(target, COUNT_DURATION_MS);
  const isRevealing = phase !== 'idle';

  const triggerReveal = useCallback(() => {
    if (phase !== 'idle') return;
    if (peakPotentialValue <= totalValue) return;
    setPhase('up');
  }, [phase, peakPotentialValue, totalValue]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerReveal();
      }
    },
    [triggerReveal],
  );

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

  return {
    animatedValue,
    isRevealing,
    peakDelta: peakPotentialValue - totalValue,
    triggerReveal,
    onKeyDown,
  };
}
