#!/usr/bin/env npx tsx
/**
 * Upsert a Claude-generated news summary for one ticker.
 * Called by the Claude generator session once per ticker, after it has written
 * the summary markdown and sources JSON to disk.
 *
 * Usage:
 *   npx tsx scripts/save-news-summary.ts <TICKER> <MARKDOWN_FILE> <SOURCES_JSON_FILE>
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (source .env.local).
 */

import fs from 'fs';
import { upsertTickerNewsSummary, type TickerNewsSource } from '../api/_lib/db.js';

function usage(): never {
  console.error('Usage: npx tsx scripts/save-news-summary.ts <TICKER> <MARKDOWN_FILE> <SOURCES_JSON_FILE>');
  process.exit(1);
}

async function main() {
  const [, , tickerArg, mdPath, sourcesPath] = process.argv;
  if (!tickerArg || !mdPath || !sourcesPath) usage();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const ticker = tickerArg.toUpperCase();
  const markdown = fs.readFileSync(mdPath, 'utf8').trim();
  if (!markdown) {
    console.error(`Empty markdown file for ${ticker} at ${mdPath}`);
    process.exit(1);
  }

  const sourcesRaw = fs.readFileSync(sourcesPath, 'utf8');
  let sources: TickerNewsSource[] = [];
  try {
    const parsed = JSON.parse(sourcesRaw);
    if (!Array.isArray(parsed)) throw new Error('sources JSON must be an array');
    sources = parsed.map((s: unknown) => {
      const item = s as { title?: unknown; url?: unknown };
      if (typeof item.title !== 'string' || typeof item.url !== 'string') {
        throw new Error('each source must be { title: string, url: string }');
      }
      return { title: item.title, url: item.url };
    });
  } catch (e) {
    console.error(`Invalid sources JSON for ${ticker}:`, (e as Error).message);
    process.exit(1);
  }

  const summaryDate = new Date().toISOString().split('T')[0];

  await upsertTickerNewsSummary({
    ticker,
    summary_date: summaryDate,
    summary_markdown: markdown,
    sources_json: sources,
  });

  console.log(`saved: ${ticker} (${summaryDate}, ${sources.length} sources, ${markdown.length} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
