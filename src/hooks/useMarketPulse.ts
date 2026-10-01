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

async function fetchPulse(token: string): Promise<MarketPulse | null> {
  const params = new URLSearchParams({ type: 'pulse', token });
  const response = await fetch(`${API_BASE_URL}/api/events?${params}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch market pulse');
  }
  return (await response.json()).pulse;
}

// The AI market snapshot (scripts/generate-pulse.sh, every 30 min in market
// hours). Preview-gated server-side by session, so it only fetches for a
// logged-in visitor; the server returns null for anyone not on the preview list.
export function useMarketPulse(loggedInAs: string | null, getToken: () => string | null) {
  const token = loggedInAs ? getToken() : null;
  return useQuery({
    queryKey: ['market-pulse', loggedInAs],
    queryFn: () => fetchPulse(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
