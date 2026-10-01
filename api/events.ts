import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getUpcomingEvents,
  getRecentMarketPulses,
  verifySessionToken,
  type UpcomingEventSource,
  type MarketPulseSource,
} from './_lib/db.js';

// Market pulse is in preview: only these logged-in portfolios get it (checked
// against the session token, not a client claim). Everyone else gets
// { pulse: null }, which the card treats as "nothing to show". To open it up,
// drop the gate below and the logged-in requirement in useMarketPulse.
const PULSE_PREVIEW_PORTFOLIOS = new Set(['av']);

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
}

async function handlePulse(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = req.query.token as string | undefined;
  const session = token ? await verifySessionToken(token) : null;
  if (!session || !PULSE_PREVIEW_PORTFOLIOS.has(session.portfolioId)) {
    res.status(200).json({ pulse: null } satisfies PulseResponse);
    return;
  }
  const [latest] = await getRecentMarketPulses(1);
  const response: PulseResponse = {
    pulse: latest
      ? {
          headline: latest.headline,
          body: latest.body,
          generatedAt: latest.generated_at,
          marketStatus: latest.market_status,
          sources: latest.sources ?? [],
        }
      : null,
  };
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
