#!/usr/bin/env npx tsx
/**
 * Persist one market pulse to the append-only market_pulse table, alongside
 * the input.json the session was given. generate-pulse.sh captures the session
 * as stream-json events in scripts/pulse-output/session.jsonl: we log the web
 * searches it ran (to tell "searched, found no driver" from "never searched")
 * and take its final reply from the closing `result` event. That reply should
 * be a bare JSON object; we take the outermost {...} in case it adds stray
 * prose or a fence.
 *
 * Usage:
 *   npx tsx scripts/save-pulse.ts <model>
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (source .env.local).
 */

import fs from 'fs';
import { insertMarketPulse, type MarketPulseSource } from '../api/_lib/db.js';

const SESSION_PATH = 'scripts/pulse-output/session.jsonl';
const INPUT_PATH = 'scripts/pulse-output/input.json';

// Mirrors the limits in pulse-prompt.md. Over-long output is still saved (one
// verbose run shouldn't blank the card) but warned on so drift shows in the log;
// only an empty or wildly long pulse is rejected.
const HEADLINE_MAX = 40;
const BODY_WORDS_MAX = 65;
const BODY_HARD_MAX_CHARS = 600;

interface SessionEvent {
  type: string;
  message?: { content?: unknown };
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
}

interface Mover {
  ticker: string;
  name: string;
}

// Movers the pulse text mentions, by ticker or by the first word of the
// company name ("Micron" for "Micron Technology, Inc.") — a heuristic that's
// good enough for a log warning.
function namedMovers(text: string, movers: { regularSession?: Mover[] | null; extendedHours?: Mover[] | null }): string[] {
  const all = [...(movers.regularSession ?? []), ...(movers.extendedHours ?? [])];
  const named = all.filter((m) => {
    const first = m.name.replace(/^The\s+/, '').split(/[\s,.]+/)[0];
    return [m.ticker, first].some((word) =>
      word.length > 1 && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));
  });
  return [...new Set(named.map((m) => m.ticker))];
}

// The final reply text, after logging the session's searches and stats.
function readSession(): string {
  const events: SessionEvent[] = fs.readFileSync(SESSION_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const queries: string[] = [];
  for (const e of events) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message.content as { type?: string; name?: string; input?: { query?: string } }[]) {
      if (block.type === 'tool_use' && block.name === 'WebSearch') queries.push(block.input?.query ?? '?');
    }
  }

  const result = events.find((e) => e.type === 'result');
  if (!result) throw new Error('session has no result event (session died mid-run?)');
  const secs = Math.round((result.duration_ms ?? 0) / 1000);
  const cost = result.total_cost_usd?.toFixed(3) ?? '?';
  console.log(`save-pulse: session ${result.num_turns ?? '?'} turns, ${secs}s, $${cost}; ` +
    `${queries.length} searches${queries.length ? ': ' + queries.map((q) => `"${q}"`).join(' | ') : ''}`);
  if (queries.length === 0) console.warn('save-pulse: session ran no web searches');
  if (result.is_error || typeof result.result !== 'string') {
    throw new Error(`session ended in error: ${String(result.result).slice(0, 200)}`);
  }
  return result.result;
}

async function main(): Promise<void> {
  const model = process.argv[2] ?? null;
  const text = readSession();
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

  // Prompt hard rule 3: a named mover needs a source explaining its move.
  const named = namedMovers(`${headline} ${body}`, input.movers ?? {});
  if (named.length && !sources.length) {
    console.warn(`save-pulse: names ${named.join(', ')} with no sources (prompt rule 3)`);
  }

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
