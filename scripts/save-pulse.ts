#!/usr/bin/env npx tsx
/**
 * Persist one market pulse to the append-only market_pulse table, alongside
 * the input.json the session was given. The session's final reply (captured to
 * scripts/pulse-output/response.txt by generate-pulse.sh) should be a bare JSON
 * object; we take the outermost {...} in case it adds stray prose or a fence.
 *
 * Usage:
 *   npx tsx scripts/save-pulse.ts <model>
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (source .env.local).
 */

import fs from 'fs';
import { insertMarketPulse, type MarketPulseSource } from '../api/_lib/db.js';

const RESPONSE_PATH = 'scripts/pulse-output/response.txt';
const INPUT_PATH = 'scripts/pulse-output/input.json';

// Mirrors the limits in pulse-prompt.md. Over-long output is still saved (one
// verbose run shouldn't blank the card) but warned on so drift shows in the log;
// only an empty or wildly long pulse is rejected.
const HEADLINE_MAX = 40;
const BODY_WORDS_MAX = 65;
const BODY_HARD_MAX_CHARS = 600;

async function main(): Promise<void> {
  const model = process.argv[2] ?? null;
  const text = fs.readFileSync(RESPONSE_PATH, 'utf8');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no JSON object in response: ${text.slice(0, 200)}`);
  const raw = JSON.parse(text.slice(start, end + 1));
  const input = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));

  const headline = typeof raw.headline === 'string' ? raw.headline.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!headline || !body) throw new Error('response is missing headline or body');
  if (body.length > BODY_HARD_MAX_CHARS) throw new Error(`body is ${body.length} chars — refusing to save`);

  if (headline.length > HEADLINE_MAX) {
    console.warn(`save-pulse: headline is ${headline.length} chars (> ${HEADLINE_MAX})`);
  }
  const words = body.split(/\s+/).length;
  if (words > BODY_WORDS_MAX) {
    console.warn(`save-pulse: body is ${words} words (> ${BODY_WORDS_MAX})`);
  }

  const sources: MarketPulseSource[] = Array.isArray(raw.sources)
    ? raw.sources
        .filter((s: unknown): s is MarketPulseSource =>
          typeof (s as MarketPulseSource)?.title === 'string' &&
          typeof (s as MarketPulseSource)?.url === 'string' &&
          /^https?:\/\//.test((s as MarketPulseSource).url))
        .slice(0, 3)
    : [];

  await insertMarketPulse({
    market_status: input.marketStatus,
    headline,
    body,
    sources,
    model,
    input,
  });
  console.log(`save-pulse: saved "${headline}" (${words} words, ${sources.length} sources)`);
}

main().catch((err) => {
  console.error('save-pulse failed:', err);
  process.exit(1);
});
