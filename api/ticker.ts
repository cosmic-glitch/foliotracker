import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTickerChart, type TickerChartRange } from './_lib/yahoo.js';

// Public price history for one ticker, proxied straight from Yahoo on every
// request. No auth: ticker prices are public data, and the caller only learns
// which symbol was asked for. No server-side cache either — this backs a
// click-to-open detail panel, so volume is a handful of calls per visit.
const RANGES: TickerChartRange[] = ['1d', '1mo', '6mo', 'ytd', '1y', '5y', 'max'];

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

  const symbol = (req.query.symbol as string | undefined)?.trim().toUpperCase();
  const range = req.query.range as string | undefined;

  if (!symbol || !/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'symbol parameter is required' });
    return;
  }
  if (!range || !RANGES.includes(range as TickerChartRange)) {
    res.status(400).json({ error: `range must be one of ${RANGES.join(', ')}` });
    return;
  }

  try {
    const chart = await getTickerChart(symbol, range as TickerChartRange);
    if (!chart) {
      res.status(404).json({ error: 'No price history for symbol' });
      return;
    }
    // Let the browser/CDN hold a response briefly so range-flipping on the
    // same ticker doesn't hammer Yahoo; still refreshes within a session.
    // Intraday gets a shorter hold so a reopened panel tracks the live tape.
    res.setHeader('Cache-Control', `public, max-age=${range === '1d' ? 60 : 300}`);
    res.status(200).json(chart);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ticker chart failed for ${symbol}/${range}:`, error);
    res.status(502).json({ error: 'Failed to fetch price history' });
  }
}
