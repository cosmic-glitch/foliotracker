const FMP_API_KEY = process.env.FMP_API_KEY!;
const FMP_STABLE_URL = 'https://financialmodelingprep.com/stable';

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

// FMP profile response for symbol info
interface FMPProfile {
  symbol: string;
  companyName: string;
  exchange: string;
  industry: string;
}

export interface SymbolInfo {
  name: string;
  instrumentType: string;
}

// Infer instrument type from FMP profile data
function inferInstrumentType(exchange: string, industry: string): string {
  // ETFs trade on AMEX (NYSE Arca) with Asset Management industry
  if (exchange === 'AMEX' && industry === 'Asset Management') {
    return 'ETF';
  }
  // Mutual funds trade on NASDAQ with Asset Management industry
  if (exchange === 'NASDAQ' && industry === 'Asset Management') {
    return 'Mutual Fund';
  }
  // Everything else is a stock
  return 'Common Stock';
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  try {
    const response = await fetch(
      `${FMP_STABLE_URL}/quote?symbol=${symbol}&apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
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
      previousClose: quote.previousClose,
      changePercent: quote.changePercentage,
    };
  } catch (error) {
    console.error(`Error fetching FMP quote for ${symbol}:`, error);
    return null;
  }
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();

  if (symbols.length === 0) {
    return results;
  }

  try {
    // FMP stable endpoint supports comma-separated symbols
    const symbolList = symbols.join(',');
    const response = await fetch(
      `${FMP_STABLE_URL}/quote?symbol=${symbolList}&apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
      console.error(`FMP batch API error: ${response.status}`);
      return results;
    }

    const data: FMPStableQuote[] = await response.json();

    if (!data || !Array.isArray(data)) {
      console.warn('Invalid FMP batch response');
      return results;
    }

    for (const quote of data) {
      if (quote.price) {
        results.set(quote.symbol, {
          currentPrice: quote.price,
          previousClose: quote.previousClose,
          changePercent: quote.changePercentage,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching FMP batch quotes:', error);
  }

  return results;
}

export async function getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  try {
    const response = await fetch(
      `${FMP_STABLE_URL}/profile?symbol=${symbol}&apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
      return null;
    }

    const data: FMPProfile[] = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const profile = data[0];
    return {
      name: profile.companyName || symbol,
      instrumentType: inferInstrumentType(profile.exchange, profile.industry),
    };
  } catch (error) {
    console.error(`Error fetching symbol info for ${symbol}:`, error);
    return null;
  }
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
    if (interval === '1m') {
      // Use Yahoo Finance for intraday (free, no API key needed)
      const period1 = Math.floor(from.getTime() / 1000);
      const period2 = Math.floor(to.getTime() / 1000);
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1m`;

      const response = await fetch(yahooUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (!response.ok) {
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
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    return [];
  }
}
