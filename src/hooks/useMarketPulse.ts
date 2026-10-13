import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Mirrors PulseResponse in api/events.ts.
export interface MarketPulse {
  headline: string;
  body: string;
  generatedAt: string;
  marketStatus: string;
  sources: { title: string; url: string }[];
}

export interface PulsePage {
  pulse: MarketPulse | null;
  hasOlder: boolean;
}

// `before` is a generatedAt string passed back verbatim (it keeps Postgres's
// microseconds, which a Date round-trip would drop and skip a row).
async function fetchPulse(before?: string): Promise<PulsePage> {
  const url = before
    ? `${API_BASE_URL}/api/events?type=pulse&before=${encodeURIComponent(before)}`
    : `${API_BASE_URL}/api/events?type=pulse`;
  // Older pulses are immutable and CDN-cached; only the latest must bypass caches.
  const response = await fetch(url, before ? undefined : { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch market pulse');
  }
  const data = await response.json();
  return { pulse: data.pulse, hasOlder: Boolean(data.hasOlder) };
}

// The AI market snapshot (scripts/generate-pulse.sh, every 30 min in market
// hours). Public: served to every visitor, logged in or not.
export function useMarketPulse() {
  return useQuery({
    queryKey: ['market-pulse'],
    queryFn: () => fetchPulse(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

const olderKey = (before: string) => ['market-pulse', 'before', before];

// The pulse just older than `before`; disabled (no request) when null.
// keepPreviousData holds the current pulse on screen while the next loads.
export function useOlderPulse(before: string | null) {
  return useQuery({
    queryKey: olderKey(before ?? ''),
    queryFn: () => fetchPulse(before!),
    enabled: before !== null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

// Warm the cache for the pulse older than `before`, so ‹ is instant.
export function usePrefetchOlderPulse() {
  const queryClient = useQueryClient();
  return useCallback(
    (before: string) =>
      queryClient.prefetchQuery({
        queryKey: olderKey(before),
        queryFn: () => fetchPulse(before),
        staleTime: Infinity,
      }),
    [queryClient],
  );
}
