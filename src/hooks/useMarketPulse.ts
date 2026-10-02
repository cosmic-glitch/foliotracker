import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Mirrors PulseResponse in api/events.ts.
export interface MarketPulse {
  headline: string;
  body: string;
  generatedAt: string;
  marketStatus: string;
  sources: { title: string; url: string }[];
}

async function fetchPulse(): Promise<MarketPulse | null> {
  const response = await fetch(`${API_BASE_URL}/api/events?type=pulse`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch market pulse');
  }
  return (await response.json()).pulse;
}

// The AI market snapshot (scripts/generate-pulse.sh, every 30 min in market
// hours). Public: served to every visitor, logged in or not.
export function useMarketPulse() {
  return useQuery({
    queryKey: ['market-pulse'],
    queryFn: fetchPulse,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
