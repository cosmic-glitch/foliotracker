const FMP_API_KEY = process.env.FMP_API_KEY!;
const FMP_STABLE_URL = 'https://financialmodelingprep.com/stable';

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

// FMP stable quote response
interface FMPStableQuote {
  symbol: string;
  name: string;
  price: number;
  changePercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  exchange: string;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  timestamp: number;
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
        console.error(`Yahoo API error for ${symbol}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;

      if (!meta?.regularMarketPrice) {
        console.warn(`No Yahoo data for ${symbol}`);
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
    console.error(`Error fetching Yahoo quote for ${symbol}:`, error);
    return null;
  }
}

// FMP quote (fallback)
async function getFMPQuote(symbol: string): Promise<Quote | null> {
  try {
    return await withRetry(async () => {
      const response = await fetch(
        `${FMP_STABLE_URL}/quote?symbol=${symbol}&apikey=${FMP_API_KEY}`
      );

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`FMP API error ${response.status} (will retry)`);
        }
        console.error(`FMP API error for ${symbol}: ${response.status}`);
        return null;
      }

      const data: FMPStableQuote[] = await response.json();

      if (!data || data.length === 0 || !data[0].price) {
        console.warn(`No FMP data for ${symbol}`);
        return null;
      }

      const quote = data[0];
      return {
        currentPrice: quote.price,
        previousClose: quote.previousClose ?? quote.price,
        changePercent: quote.changePercentage ?? 0,
      };
    });
  } catch (error) {
    console.error(`Error fetching FMP quote for ${symbol}:`, error);
    return null;
  }
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  // Try Yahoo Finance first (faster, no API key required)
  const yahooQuote = await getYahooQuote(symbol);
  if (yahooQuote) return yahooQuote;

  // Fall back to FMP if Yahoo fails
  return getFMPQuote(symbol);
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();

  if (symbols.length === 0) {
    return results;
  }

  // Fetch each symbol in parallel (Yahoo Finance primary, FMP fallback)
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
          console.error(`Yahoo Finance intraday API error for ${symbol}: ${response.status}`);
          return [];
        }

        const data = await response.json();
        const result = data.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) {
          console.warn(`No Yahoo Finance intraday data for ${symbol}`);
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
        // Daily historical endpoint
        const fromStr = from.toISOString().split('T')[0];
        const toStr = to.toISOString().split('T')[0];

        const response = await fetch(
          `${FMP_STABLE_URL}/historical-price-eod/full?symbol=${symbol}&from=${fromStr}&to=${toStr}&apikey=${FMP_API_KEY}`
        );

        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`FMP daily API error ${response.status} (will retry)`);
          }
          console.error(`FMP daily API error for ${symbol}: ${response.status}`);
          return [];
        }

        const data = await response.json();

        // Stable endpoint returns a flat array, not { historical: [...] }
        if (!data || !Array.isArray(data) || data.length === 0) {
          console.warn(`No FMP daily data for ${symbol}`);
          return [];
        }

        // FMP returns data in reverse chronological order, so reverse it
        const historicalData: { date: string; close: number }[] = [];
        for (let i = data.length - 1; i >= 0; i--) {
          const point = data[i];
          if (point.close !== null) {
            historicalData.push({
              date: point.date,
              close: point.close,
            });
          }
        }

        return historicalData;
      }
    });
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    return [];
  }
}
