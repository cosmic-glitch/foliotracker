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
      // Intraday endpoint (note: may be restricted on some plans)
      const response = await fetch(
        `${FMP_STABLE_URL}/historical-chart/1min/${symbol}?apikey=${FMP_API_KEY}`
      );

      if (!response.ok) {
        console.error(`FMP intraday API error for ${symbol}: ${response.status}`);
        return [];
      }

      const data = await response.json();

      if (!data || !Array.isArray(data) || data.length === 0) {
        console.warn(`No FMP intraday data for ${symbol}`);
        return [];
      }

      // FMP returns data in reverse chronological order, so reverse it
      const fromTime = from.getTime();
      const toTime = to.getTime();

      const historicalData: { date: string; close: number }[] = [];
      for (let i = data.length - 1; i >= 0; i--) {
        const point = data[i];
        const pointTime = new Date(point.date).getTime();

        if (pointTime >= fromTime && pointTime <= toTime && point.close !== null) {
          historicalData.push({
            date: point.date,
            close: point.close,
          });
        }
      }

      return historicalData;
    } else {
      // Daily historical endpoint
      const fromStr = from.toISOString().split('T')[0];
      const toStr = to.toISOString().split('T')[0];

      const response = await fetch(
        `${FMP_STABLE_URL}/historical-price-full?symbol=${symbol}&from=${fromStr}&to=${toStr}&apikey=${FMP_API_KEY}`
      );

      if (!response.ok) {
        console.error(`FMP daily API error for ${symbol}: ${response.status}`);
        return [];
      }

      const data = await response.json();

      if (!data || !data.historical || data.historical.length === 0) {
        console.warn(`No FMP daily data for ${symbol}`);
        return [];
      }

      // FMP returns data in reverse chronological order, so reverse it
      const historicalData: { date: string; close: number }[] = [];
      for (let i = data.historical.length - 1; i >= 0; i--) {
        const point = data.historical[i];
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
