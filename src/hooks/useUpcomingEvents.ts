import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export interface UpcomingEventSource {
  title: string;
  url: string;
}

export interface UpcomingEvent {
  id: string;
  type: 'macro' | 'earnings';
  date: string; // YYYY-MM-DD
  time: string | null;
  title: string;
  detail: string;
  importance: 'high' | 'medium' | 'low';
  tickers: string[];
  holders: string[] | null; // null for macro events
  holderCount: number;
  source: UpcomingEventSource | null;
}

interface EventsResponse {
  events: UpcomingEvent[];
}

async function fetchEvents(): Promise<EventsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/events`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch upcoming events');
  }
  return response.json();
}

// The Upcoming Events feed for the landing page. One global list (not
// portfolio-specific), regenerated daily by scripts/generate-events.sh, so a
// long staleTime is fine.
export function useUpcomingEvents() {
  return useQuery({
    queryKey: ['upcoming-events'],
    queryFn: fetchEvents,
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
