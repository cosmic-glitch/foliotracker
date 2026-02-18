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

function formatHoldingsList(holdings: HoldingSummary[]): string {
  return holdings
    .map(
      (h) =>
        `- ${h.ticker} (${h.name}): $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%) - ${h.instrumentType}`
    )
    .join('\n');
}

function formatPortfolioContext(holdings: HoldingSummary[], totalValue: number): string {
  return `Portfolio total value: $${totalValue.toLocaleString()}\n\nHoldings:\n${formatHoldingsList(holdings)}`;
}

export async function generateHotTake(
  holdings: HoldingSummary[],
  totalValue: number
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.2-chat-latest',
    messages: [
      {
        role: 'system',
        content: `You are a witty, opinionated financial commentator. Give a "hot take" on this portfolio - be interesting, catchy, maybe slightly provocative. Keep it to 2-3 sentences max. Comment on allocation choices, sector exposure, risk level, or interesting picks. Don't be boring or generic.`,
      },
      {
        role: 'user',
        content: formatPortfolioContext(holdings, totalValue),
      },
    ],
    max_completion_tokens: 200,
  });

  return response.choices[0].message.content || 'No hot take available.';
}

export async function generateBuffettComment(
  holdings: HoldingSummary[],
  totalValue: number
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.2-chat-latest',
    messages: [
      {
        role: 'system',
        content: `You are Warren Buffett, the legendary investor from Omaha. Analyze this portfolio through your value investing lens.

Focus on:
- Margin of safety and intrinsic value
- Circle of competence - do these businesses make sense?
- Long-term competitive advantages (moats)
- Quality of businesses vs. speculation
- Patient, long-term thinking vs. short-term trading

Speaking style:
- Folksy wisdom with Omaha sensibility
- Baseball and business analogies
- Calm, patient, grandfatherly tone
- Occasional self-deprecating humor
- Reference your own investment philosophy and past experiences

Keep it to 2-3 sentences. Be genuine to Buffett's character - he's optimistic about America but skeptical of speculation.`,
      },
      {
        role: 'user',
        content: formatPortfolioContext(holdings, totalValue),
      },
    ],
    max_completion_tokens: 250,
  });

  return response.choices[0].message.content || 'No comment available.';
}

export async function generateMungerComment(
  holdings: HoldingSummary[],
  totalValue: number
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.2-chat-latest',
    messages: [
      {
        role: 'system',
        content: `You are Charlie Munger, Warren Buffett's longtime partner and vice chairman of Berkshire Hathaway. Analyze this portfolio with your characteristic bluntness.

Focus on:
- Mental models and multi-disciplinary thinking
- Avoiding stupidity over seeking brilliance
- Inversion - what could go wrong?
- Psychology of investing and cognitive biases
- Quality businesses at fair prices
- Concentration vs. diversification

Speaking style:
- Sharp wit and intellectual rigor
- Brutally honest, sometimes acerbic
- Literary and historical references
- Psychology insights about human folly
- Direct, no-nonsense assessments
- Occasional dark humor

Keep it to 2-3 sentences. Be genuine to Munger's character - he doesn't suffer fools gladly and says exactly what he thinks.`,
      },
      {
        role: 'user',
        content: formatPortfolioContext(holdings, totalValue),
      },
    ],
    max_completion_tokens: 250,
  });

  return response.choices[0].message.content || 'No comment available.';
}

export type AIPersona = 'hot-take' | 'buffett' | 'munger';

function getPersonaSystemPrompt(
  persona: AIPersona,
  initialComment: string,
  holdingsList: string,
  totalValue: number
): string {
  const portfolioContext = `Current portfolio ($${totalValue.toLocaleString()} total):\n${holdingsList}`;

  switch (persona) {
    case 'buffett':
      return `You are Warren Buffett, the legendary investor from Omaha. You previously commented on this portfolio: "${initialComment}"

${portfolioContext}

Continue the conversation as Warren Buffett:
- Use folksy wisdom and Omaha sensibility
- Reference baseball and business analogies
- Maintain a calm, patient, grandfatherly tone
- Focus on value investing, margin of safety, competitive moats
- Be optimistic about America but skeptical of speculation
Keep responses concise (2-4 sentences).`;

    case 'munger':
      return `You are Charlie Munger, Warren Buffett's longtime partner. You previously commented on this portfolio: "${initialComment}"

${portfolioContext}

Continue the conversation as Charlie Munger:
- Use sharp wit and intellectual rigor
- Be brutally honest and direct
- Reference mental models and multi-disciplinary thinking
- Focus on avoiding stupidity and cognitive biases
- Use literary and historical references when appropriate
Keep responses concise (2-4 sentences).`;

    case 'hot-take':
    default:
      return `You are a witty financial commentator. You previously gave this hot take on the portfolio: "${initialComment}"

${portfolioContext}

Continue the conversation naturally. Be helpful but maintain your witty personality. Keep responses concise (2-4 sentences).`;
  }
}

export async function chatWithPortfolio(
  holdings: HoldingSummary[],
  totalValue: number,
  initialComment: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  persona: AIPersona = 'hot-take'
): Promise<string> {
  const holdingsList = holdings
    .map(
      (h) => `- ${h.ticker}: $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%)`
    )
    .join('\n');

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: getPersonaSystemPrompt(persona, initialComment, holdingsList, totalValue),
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-5.2-chat-latest',
    messages,
    max_completion_tokens: 300,
  });

  return response.choices[0].message.content || 'I have nothing to say about that.';
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
          ? ` | Unrealized: ${h.profitLoss >= 0 ? '+' : ''}$${h.profitLoss.toLocaleString()} (${h.profitLossPercent?.toFixed(1)}%)`
          : '';
      return `- ${h.ticker} (${h.name}): $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%) [${h.instrumentType} | ${linkageTag}]${gainInfo}`;
    })
    .join('\n');

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
