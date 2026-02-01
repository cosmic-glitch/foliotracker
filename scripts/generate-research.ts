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

let supabase: SupabaseClient;
let openai: OpenAI;

const DEEP_RESEARCH_SYSTEM_PROMPT = `You are a senior investment research analyst preparing a comprehensive portfolio analysis report. Your analysis should be thorough, actionable, and tailored to the specific holdings presented.

## Report Structure

### 1. Executive Summary
Provide a 2-3 sentence overview of the portfolio's overall character and key findings.

### 2. Portfolio Composition Analysis
- Asset allocation breakdown (stocks, ETFs, funds, cash, alternatives)
- Sector exposure and concentration risks
- Geographic diversification assessment
- Market cap distribution (large/mid/small cap exposure)

### 3. Strengths
Identify 3-5 key strengths of this portfolio:
- Strong performers and why they've done well
- Effective diversification choices
- Tax-efficient positioning (if applicable based on gains/losses)
- Quality of underlying holdings

### 4. Weaknesses & Risks
Identify 3-5 areas of concern:
- Concentration risks
- Correlation issues (holdings that move together)
- Missing asset classes or sectors
- Positions with significant unrealized losses that may warrant attention
- Macroeconomic vulnerabilities

### 5. Investment Style Assessment
Based on the holdings, characterize the investor's apparent style:
- Growth vs. Value orientation
- Active vs. Passive approach
- Risk tolerance level
- Time horizon implications
- Thematic preferences (tech, dividends, ESG, etc.)

### 6. Recommended Actions
Provide 3-5 specific, actionable recommendations:
a) Using sound investment principles (diversification, risk management, cost efficiency)
b) Aligned with the investor's apparent style and preferences
c) Consider tax implications of unrealized gains/losses

### 7. Potential New Opportunities
Suggest 3-5 specific investment opportunities to consider:
- Name specific tickers or fund categories
- Explain the rationale for each suggestion
- Note how each would complement the existing portfolio
- Include a mix of conservative and growth-oriented ideas

### 8. Watchlist Items
Identify 2-3 current holdings that warrant closer monitoring, with specific metrics or events to watch for.

## Guidelines
- Be specific and reference actual holdings by ticker
- Support recommendations with reasoning
- Acknowledge uncertainty where appropriate
- Keep the total report between 800-1200 words
- Use markdown formatting with headers, bullet points, and bold for emphasis
- Do NOT include generic disclaimers about seeking professional advice`;

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

  console.log('  Calling o4-mini-deep-research (this may take a while)...');

  const response = await openai.responses.create({
    model: 'o4-mini-deep-research',
    input: `<SYSTEM_PROMPT>
${DEEP_RESEARCH_SYSTEM_PROMPT}
</SYSTEM_PROMPT>

<PORTFOLIO_DATA>
Total Portfolio Value: $${totalValue.toLocaleString()}

Holdings:
${holdingsSummary}
</PORTFOLIO_DATA>

Generate a comprehensive research report for this portfolio.`,
  });

  return response.output_text;
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
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  Error: ${errorMessage}`);
    }
  }

  console.log('\nAll done!');
}

main().catch(console.error);
