import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface HoldingSummary {
  ticker: string;
  name: string;
  value: number;
  allocation: number;
  instrumentType: string;
}

export async function generateHotTake(
  holdings: HoldingSummary[],
  totalValue: number
): Promise<string> {
  const holdingsList = holdings
    .map(
      (h) =>
        `- ${h.ticker} (${h.name}): $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%) - ${h.instrumentType}`
    )
    .join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a witty, opinionated financial commentator. Give a "hot take" on this portfolio - be interesting, catchy, maybe slightly provocative. Keep it to 2-3 sentences max. Comment on allocation choices, sector exposure, risk level, or interesting picks. Don't be boring or generic.`,
      },
      {
        role: 'user',
        content: `Portfolio total value: $${totalValue.toLocaleString()}\n\nHoldings:\n${holdingsList}`,
      },
    ],
    max_tokens: 200,
    temperature: 0.9,
  });

  return response.choices[0].message.content || 'No hot take available.';
}

export async function chatWithPortfolio(
  holdings: HoldingSummary[],
  totalValue: number,
  hotTake: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string
): Promise<string> {
  const holdingsList = holdings
    .map(
      (h) => `- ${h.ticker}: $${h.value.toLocaleString()} (${h.allocation.toFixed(1)}%)`
    )
    .join('\n');

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a witty financial commentator. You previously gave this hot take on the portfolio: "${hotTake}"

Current portfolio ($${totalValue.toLocaleString()} total):
${holdingsList}

Continue the conversation naturally. Be helpful but maintain your witty personality. Keep responses concise (2-4 sentences).`,
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 300,
    temperature: 0.8,
  });

  return response.choices[0].message.content || 'I have nothing to say about that.';
}
