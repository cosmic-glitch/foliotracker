#!/usr/bin/env npx tsx
/**
 * Generate AI Research reports for specific portfolios using o4-mini-deep-research
 *
 * Usage:
 *   source .env.local
 *   npx tsx scripts/generate-research.ts <portfolio_id> [portfolio_id2] ...
 *   npx tsx scripts/generate-research.ts --all
 *
 * Examples:
 *   npx tsx scripts/generate-research.ts anurag
 *   npx tsx scripts/generate-research.ts anurag john jane
 *   npx tsx scripts/generate-research.ts --all
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { DEEP_RESEARCH_SYSTEM_PROMPT } from '../api/_lib/prompts.js';

let supabase: SupabaseClient;
let openai: OpenAI;

interface SnapshotHolding {
  ticker: string;
  name: string;
  value: number;
  allocation: number;
  instrumentType: string;
  profitLoss: number | null;
  profitLossPercent: number | null;
}

interface PortfolioSnapshot {
  portfolio_id: string;
  total_value: number;
  holdings_json: SnapshotHolding[];
}

async function getAllPortfolioIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((p) => p.id);
}

async function getPortfolioSnapshot(portfolioId: string): Promise<PortfolioSnapshot | null> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('portfolio_id, total_value, holdings_json')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateDeepResearch(portfolioId: string, research: string): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({
      deep_research: research,
      deep_research_at: new Date().toISOString(),
    })
    .eq('id', portfolioId.toLowerCase());

  if (error) throw error;
}

async function generateDeepResearch(holdings: SnapshotHolding[], totalValue: number): Promise<string> {
  const holdingsSummary = holdings
    .map((h) => {
      const gainInfo =
        h.profitLoss !== null && h.profitLoss !== undefined
          ? ` | Unrealized: ${h.profitLoss >= 0 ? '+' : ''}$${h.profitLoss.toLocaleString()} (${h.profitLossPercent?.toFixed(1)}%)`
          : '';
      return `- ${h.ticker} (${h.name}): $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%) [${h.instrumentType}]${gainInfo}`;
    })
    .join('\n');

  const input = `<SYSTEM_PROMPT>
${DEEP_RESEARCH_SYSTEM_PROMPT}
</SYSTEM_PROMPT>

<PORTFOLIO_DATA>
Total Portfolio Value: $${totalValue.toLocaleString()}

Holdings:
${holdingsSummary}
</PORTFOLIO_DATA>

Generate a comprehensive research report for this portfolio.`;

  const requestPayload = {
    model: 'o4-mini-deep-research',
    input,
    tools: [{ type: 'web_search_preview' }],
  };

  console.log('\n  === OpenAI Request ===');
  console.log(`  Model: ${requestPayload.model}`);
  console.log(`  Tools: ${JSON.stringify(requestPayload.tools)}`);
  console.log(`  Input length: ${input.length} chars`);
  console.log(`  Holdings count: ${holdings.length}`);
  console.log('  ---');
  console.log('  Input preview (first 500 chars):');
  console.log(`  ${input.substring(0, 500).replace(/\n/g, '\n  ')}...`);
  console.log('  =====================\n');

  console.log('  Calling o4-mini-deep-research (this may take a while)...');
  const startTime = Date.now();

  try {
    const response = await openai.responses.create(requestPayload as Parameters<typeof openai.responses.create>[0]);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n  === OpenAI Response ===');
    console.log(`  Status: Success`);
    console.log(`  Elapsed: ${elapsed}s`);
    console.log(`  Response ID: ${response.id}`);
    console.log(`  Output length: ${response.output_text?.length || 0} chars`);
    if (response.usage) {
      console.log(`  Usage: ${JSON.stringify(response.usage)}`);
    }
    console.log('  =====================\n');

    return response.output_text;
  } catch (error: unknown) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n  === OpenAI Error ===');
    console.log(`  Elapsed: ${elapsed}s`);
    if (error instanceof Error) {
      console.log(`  Error type: ${error.constructor.name}`);
      console.log(`  Message: ${error.message}`);
      if ('status' in error) console.log(`  Status: ${(error as { status: number }).status}`);
      if ('code' in error) console.log(`  Code: ${(error as { code: string }).code}`);
      if ('type' in error) console.log(`  Type: ${(error as { type: string }).type}`);
    } else {
      console.log(`  Error: ${JSON.stringify(error, null, 2)}`);
    }
    console.log('  =====================\n');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/generate-research.ts <portfolio_id> [portfolio_id2] ...');
    console.error('       npx tsx scripts/generate-research.ts --all');
    process.exit(1);
  }

  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60 * 60 * 1000, // 1 hour - OpenAI recommends 3600s for deep research
  });

  let portfolioIds: string[];

  if (args[0] === '--all') {
    portfolioIds = await getAllPortfolioIds();
    console.log(`Found ${portfolioIds.length} portfolios\n`);
  } else {
    portfolioIds = args;
  }

  for (const portfolioId of portfolioIds) {
    console.log(`\nGenerating research for: ${portfolioId}`);

    try {
      const snapshot = await getPortfolioSnapshot(portfolioId);

      if (!snapshot) {
        console.log('  Skipping - no snapshot available');
        continue;
      }

      if (snapshot.holdings_json.length === 0) {
        console.log('  Skipping - no holdings');
        continue;
      }

      const research = await generateDeepResearch(snapshot.holdings_json, snapshot.total_value);
      await updateDeepResearch(portfolioId, research);

      console.log(`  Done - ${research.length} characters`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
      console.error(`  Error: ${errorMessage}`);
    }
  }

  console.log('\nAll done!');
}

main().catch(console.error);
