import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUpcomingEvents, type UpcomingEventSource } from './_lib/db.js';

// Frontend-facing event shape (camelCase; mirrors src/hooks/useUpcomingEvents).
interface ApiEvent {
  id: string;
  type: 'macro' | 'earnings';
  date: string;
  time: string | null;
  title: string;
  detail: string;
  importance: 'high' | 'medium' | 'low';
  tickers: string[];
  holders: string[] | null;
  holderCount: number;
  source: UpcomingEventSource | null;
}

interface EventsResponse {
  events: ApiEvent[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rows = await getUpcomingEvents();

    const events: ApiEvent[] = rows.map((e) => ({
      id: e.id,
      type: e.event_type,
      date: e.event_date,
      time: e.event_time,
      title: e.title,
      detail: e.detail,
      importance: e.importance,
      tickers: e.tickers ?? [],
      holders: e.holders ?? null,
      holderCount: e.holder_count ?? 0,
      source: e.source ?? null,
    }));

    const response: EventsResponse = { events };
    res.status(200).json(response);
  } catch (error) {
    console.error('Events API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
