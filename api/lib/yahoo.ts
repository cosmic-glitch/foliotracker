// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = INITIAL_RETRY_DELAY_MS
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// Normalized quote interface
export interface Quote {
  currentPrice: number;
  previousClose: number;
  changePercent: number;
}

export interface SymbolInfo {
  name: string;
  instrumentType: string;
}

// Map Yahoo Finance instrumentType to our instrument types
function mapYahooQuoteType(instrumentType: string | undefined, name: string): string {
  const nameLower = name.toLowerCase();

  // Check for money market funds first (by instrumentType or name starting with "cash")
  if (instrumentType === 'MONEYMARKET' || nameLower.startsWith('cash')) {
    return 'Money Market';
  }

  switch (instrumentType) {
    case 'EQUITY':
      return 'Common Stock';
    case 'ETF':
      return 'ETF';
    case 'MUTUALFUND':
      return 'Mutual Fund';
    case 'CRYPTOCURRENCY':
      return 'Crypto';
    default:
      return 'Other';
  }
}

// Yahoo Finance symbol info (better coverage for mutual funds)
async function getYahooSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const meta = data.chart?.result?.[0]?.meta;

    if (!meta) return null;

    const name = meta.longName || meta.shortName || symbol;
    const instrumentType = meta.instrumentType;

    return {
      name,
      instrumentType: mapYahooQuoteType(instrumentType, name),
    };
  } catch {
    return null;
  }
}

// Yahoo Finance quote (faster, no API key required)
async function getYahooQuote(symbol: string): Promise<Quote | null> {
  try {
    return await withRetry(async () => {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Yahoo API error ${response.status} (will retry)`);
        }
        const ts = new Date().toISOString();
        console.error(`[${ts}] Yahoo API error - Symbol: ${symbol}, Status: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;

      if (!meta?.regularMarketPrice) {
        const ts = new Date().toISOString();
        console.warn(`[${ts}] No Yahoo data for symbol: ${symbol}`);
        return null;
      }

      const currentPrice = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose ?? currentPrice;
      const changePercent = previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : 0;

      return { currentPrice, previousClose, changePercent };
    });
  } catch (error) {
    const ts = new Date().toISOString();
    console.error(`[${ts}] Error fetching Yahoo quote for ${symbol}:`, error);
    return null;
  }
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  return getYahooQuote(symbol);
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();

  if (symbols.length === 0) {
    return results;
  }

  // Fetch each symbol in parallel using Yahoo Finance
  const fetchPromises = symbols.map(async (symbol) => {
    const quote = await getQuote(symbol);
    if (quote) {
      return { symbol, quote };
    }
    return null;
  });

  const responses = await Promise.all(fetchPromises);

  for (const response of responses) {
    if (response) {
      results.set(response.symbol, response.quote);
    }
  }

  return results;
}

export async function getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  return await getYahooSymbolInfo(symbol);
}

// Legacy function for backwards compatibility
export async function getCompanyName(symbol: string): Promise<string | null> {
  const info = await getSymbolInfo(symbol);
  return info?.name || null;
}

// Historical data functions
export async function getHistoricalData(
  symbol: string,
  from: Date,
  to: Date,
  interval: '1d' | '1m' = '1d'
): Promise<{ date: string; close: number }[]> {
  try {
    return await withRetry(async () => {
      if (interval === '1m') {
        // Use Yahoo Finance for intraday (free, no API key needed)
        const period1 = Math.floor(from.getTime() / 1000);
        const period2 = Math.floor(to.getTime() / 1000);
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1m`;

        const response = await fetch(yahooUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`Yahoo Finance intraday API error ${response.status} (will retry)`);
          }
          const ts = new Date().toISOString();
          console.error(`[${ts}] Yahoo Finance intraday API error - Symbol: ${symbol}, Status: ${response.status}`);
          return [];
        }

        const data = await response.json();
        const result = data.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) {
          const ts = new Date().toISOString();
          console.warn(`[${ts}] No Yahoo Finance intraday data for symbol: ${symbol}`);
          return [];
        }

        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        const historicalData: { date: string; close: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null) {
            historicalData.push({
              date: new Date(timestamps[i] * 1000).toISOString(),
              close: closes[i],
            });
          }
        }

        return historicalData;
      } else {
        // Daily historical - use Yahoo Finance
        const period1 = Math.floor(from.getTime() / 1000);
        const period2 = Math.floor(to.getTime() / 1000);
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;

        const response = await fetch(yahooUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`Yahoo Finance daily API error ${response.status} (will retry)`);
          }
          const timestamp = new Date().toISOString();
          console.error(`[${timestamp}] Yahoo Finance daily API error - Symbol: ${symbol}, Status: ${response.status}`);
          return [];
        }

        const data = await response.json();
        const result = data.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) {
          const timestamp = new Date().toISOString();
          console.warn(`[${timestamp}] No Yahoo Finance daily data for ${symbol}`);
          return [];
        }

        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        const historicalData: { date: string; close: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null) {
            // Format date as YYYY-MM-DD for daily data
            const dateObj = new Date(timestamps[i] * 1000);
            const dateStr = dateObj.toISOString().split('T')[0];
            historicalData.push({
              date: dateStr,
              close: closes[i],
            });
          }
        }

        return historicalData;
      }
    });
  } catch (error) {
    const ts = new Date().toISOString();
    console.error(`[${ts}] Error fetching historical data for ${symbol}:`, error);
    return [];
  }
}
