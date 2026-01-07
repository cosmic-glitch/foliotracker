const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY!;
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const CNBC_BASE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

// Known mutual funds that need CNBC API instead of Finnhub
const MUTUAL_FUNDS = ['VWUAX', 'VMFXX', 'VFIAX', 'VTSAX', 'VBTLX', 'VTIAX', 'VIGAX', 'VVIAX'];

export function isMutualFund(symbol: string): boolean {
  return MUTUAL_FUNDS.includes(symbol.toUpperCase());
}

export interface CNBCQuote {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
}

export async function getMutualFundQuote(symbol: string): Promise<CNBCQuote | null> {
  try {
    const response = await fetch(
      `${CNBC_BASE_URL}?symbols=${symbol}&requestMethod=itv&noform=1&output=json`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    if (!response.ok) {
      console.error(`CNBC API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const quote = data.FormattedQuoteResult?.FormattedQuote?.[0];

    if (!quote || !quote.last) {
      console.warn(`No CNBC data for ${symbol}`);
      return null;
    }

    const price = parseFloat(quote.last.replace(/,/g, ''));
    const change = quote.change === 'UNCH' ? 0 : parseFloat(quote.change.replace(/,/g, ''));
    const changePercent = quote.change_pct === 'UNCH' ? 0 : parseFloat(quote.change_pct.replace(/[%,]/g, ''));
    const previousClose = price - change;

    return {
      price,
      change,
      changePercent,
      previousClose,
    };
  } catch (error) {
    console.error(`Error fetching CNBC quote for ${symbol}:`, error);
    return null;
  }
}

export interface FinnhubQuote {
  c: number; // Current price
  d: number; // Change
  dp: number; // Percent change
  h: number; // High price of the day
  l: number; // Low price of the day
  o: number; // Open price of the day
  pc: number; // Previous close price
  t: number; // Timestamp
}

export interface FinnhubCandle {
  c: number[]; // Close prices
  h: number[]; // High prices
  l: number[]; // Low prices
  o: number[]; // Open prices
  s: string; // Status
  t: number[]; // Timestamps
  v: number[]; // Volume
}

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  try {
    const response = await fetch(
      `${FINNHUB_BASE_URL}/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      console.error(`Finnhub API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data: FinnhubQuote = await response.json();

    // Check if we got valid data (c=0 means no data)
    if (data.c === 0 && data.pc === 0) {
      console.warn(`No data returned for ${symbol}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`Error fetching quote for ${symbol}:`, error);
    return null;
  }
}

export async function getHistoricalData(
  symbol: string,
  from: Date,
  to: Date
): Promise<{ date: string; close: number }[]> {
  // Try Yahoo Finance first (free, no API key needed)
  try {
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(to.getTime() / 1000);

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
    const response = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (response.ok) {
      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        const historicalData: { date: string; close: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null) {
            historicalData.push({
              date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
              close: closes[i],
            });
          }
        }

        if (historicalData.length > 0) {
          return historicalData;
        }
      }
    }
  } catch (error) {
    console.warn(`Yahoo Finance error for ${symbol}:`, error);
  }

  // Fallback to Finnhub (requires paid plan for candles)
  try {
    const fromTimestamp = Math.floor(from.getTime() / 1000);
    const toTimestamp = Math.floor(to.getTime() / 1000);

    const response = await fetch(
      `${FINNHUB_BASE_URL}/stock/candle?symbol=${symbol}&resolution=D&from=${fromTimestamp}&to=${toTimestamp}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      console.error(`Finnhub candle API error for ${symbol}: ${response.status}`);
      return [];
    }

    const data: FinnhubCandle = await response.json();

    if (data.s !== 'ok' || !data.c || !data.t) {
      console.warn(`No candle data for ${symbol}`);
      return [];
    }

    return data.t.map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toISOString().split('T')[0],
      close: data.c[i],
    }));
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    return [];
  }
}

// Use Twelve Data for fetching company/fund names (covers stocks, ETFs, and mutual funds)
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

export interface SymbolInfo {
  name: string;
  instrumentType: string;
}

export async function getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  try {
    const response = await fetch(
      `${TWELVE_DATA_BASE_URL}/symbol_search?symbol=${encodeURIComponent(symbol)}`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      // Find exact match first, otherwise use first result
      const exactMatch = data.data.find(
        (d: { symbol: string }) => d.symbol.toUpperCase() === symbol.toUpperCase()
      );
      const match = exactMatch || data.data[0];
      return {
        name: match.instrument_name || symbol,
        instrumentType: match.instrument_type || 'Other',
      };
    }

    return null;
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

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Map<string, FinnhubQuote>> {
  const results = new Map<string, FinnhubQuote>();

  // Fetch in parallel but respect rate limits
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const promises = batch.map((symbol) => getQuote(symbol));
    const quotes = await Promise.all(promises);

    batch.forEach((symbol, index) => {
      const quote = quotes[index];
      if (quote) {
        results.set(symbol, quote);
      }
    });

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}
