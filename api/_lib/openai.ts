import OpenAI from 'openai';
import { DEEP_RESEARCH_SYSTEM_PROMPT } from './prompts.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Re-export for backwards compatibility
export { DEEP_RESEARCH_SYSTEM_PROMPT };

export interface HoldingSummary {
  ticker: string;
  name: string;
  value: number;
  allocation: number;
  instrumentType: string;
  isStatic?: boolean;
  profitLoss?: number | null;
  profitLossPercent?: number | null;
}

function formatDollarAmount(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatSignedDollarAmount(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export async function generateDeepResearch(
  holdings: HoldingSummary[],
  totalValue: number
): Promise<string> {
  const holdingsSummary = holdings
    .map((h) => {
      const linkageTag = h.isStatic === true ? 'STATIC' : 'MARKET_LINKED';
      const gainInfo =
        h.profitLoss !== null && h.profitLoss !== undefined
          ? ` | Unrealized: ${formatSignedDollarAmount(h.profitLoss)} (${h.profitLossPercent?.toFixed(1)}%)`
          : '';
      return `- ${h.ticker} (${h.name}): ${formatDollarAmount(h.value)} (${h.allocation.toFixed(1)}%) [${h.instrumentType} | ${linkageTag}]${gainInfo}`;
    })
    .join('\n');

  const response = await openai.responses.create({
    model: 'o4-mini-deep-research',
    input: `<SYSTEM_PROMPT>
${DEEP_RESEARCH_SYSTEM_PROMPT}
</SYSTEM_PROMPT>

<PORTFOLIO_DATA>
Total Portfolio Value: ${formatDollarAmount(totalValue)}

Holdings:
${holdingsSummary}
</PORTFOLIO_DATA>

Generate a comprehensive research report for this portfolio.`,
  });

  return response.output_text;
}
