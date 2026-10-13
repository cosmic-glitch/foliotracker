import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getUpcomingEvents,
  getRecentMarketPulses,
  type UpcomingEventSource,
  type MarketPulseSource,
} from './_lib/db.js';

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

// Mirrors MarketPulse in src/hooks/useMarketPulse.ts.
interface PulseResponse {
  pulse: {
    headline: string;
    body: string;
    generatedAt: string;
    marketStatus: string;
    sources: MarketPulseSource[];
  } | null;
  // Whether a pulse older than this one exists (drives the ‹ button).
  hasOlder: boolean;
}

// No `before` → the latest pulse (uncached: it changes every 30 min). With
// `before=<generatedAt>` → the next older one. History is append-only, so the
// pulse before a given one never changes and the CDN can hold it for a day.
async function handlePulse(req: VercelRequest, res: VercelResponse): Promise<void> {
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  if (before !== undefined && Number.isNaN(Date.parse(before))) {
    res.status(400).json({ error: 'Invalid before' });
    return;
  }
  // Fetch one extra row to learn whether anything older exists.
  const [pulse, older] = await getRecentMarketPulses(2, before);
  const response: PulseResponse = {
    pulse: pulse
      ? {
          headline: pulse.headline,
          body: pulse.body,
          generatedAt: pulse.generated_at,
          marketStatus: pulse.market_status,
          sources: pulse.sources ?? [],
        }
      : null,
    hasOlder: Boolean(older),
  };
  if (before) res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.status(200).json(response);
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
    // ?type=pulse rides on this endpoint because the Hobby plan caps us at 12
    // serverless functions and api/ is already at 12.
    if (req.query.type === 'pulse') {
      await handlePulse(req, res);
      return;
    }

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
