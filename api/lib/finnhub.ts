const FMP_API_KEY = process.env.FMP_API_KEY!;
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';
const CNBC_BASE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

// Known mutual funds that need CNBC API instead of FMP
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

// FMP Quote interface
export interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
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
  eps: number;
  pe: number;
  earningsAnnouncement: string;
  sharesOutstanding: number;
  timestamp: number;
}

// Normalized quote interface (consistent across data sources)
export interface Quote {
  currentPrice: number;
  previousClose: number;
  changePercent: number;
}

export async function getFMPQuote(symbol: string): Promise<Quote | null> {
  try {
    const response = await fetch(
      `${FMP_BASE_URL}/quote/${symbol}?apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
      console.error(`FMP API error for ${symbol}: ${response.status}`);
      return null;
    }

    const data: FMPQuote[] = await response.json();

    if (!data || data.length === 0 || !data[0].price) {
      console.warn(`No FMP data for ${symbol}`);
      return null;
    }

    const quote = data[0];
    return {
      currentPrice: quote.price,
      previousClose: quote.previousClose,
      changePercent: quote.changesPercentage,
    };
  } catch (error) {
    console.error(`Error fetching FMP quote for ${symbol}:`, error);
    return null;
  }
}

export async function getMultipleFMPQuotes(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();

  if (symbols.length === 0) {
    return results;
  }

  try {
    // FMP supports batch quotes with comma-separated symbols
    const symbolList = symbols.join(',');
    const response = await fetch(
      `${FMP_BASE_URL}/quote/${symbolList}?apikey=${FMP_API_KEY}`
    );

    if (!response.ok) {
      console.error(`FMP batch API error: ${response.status}`);
      return results;
    }

    const data: FMPQuote[] = await response.json();

    if (!data || !Array.isArray(data)) {
      console.warn('Invalid FMP batch response');
      return results;
    }

    for (const quote of data) {
      if (quote.price) {
        results.set(quote.symbol, {
          currentPrice: quote.price,
          previousClose: quote.previousClose,
          changePercent: quote.changesPercentage,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching FMP batch quotes:', error);
  }

  return results;
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
      // Use FMP 1-minute intraday endpoint
      const response = await fetch(
        `${FMP_BASE_URL}/historical-chart/1min/${symbol}?apikey=${FMP_API_KEY}`
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
      // Filter to only include data within the date range
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
      // Use FMP daily historical endpoint
      const fromStr = from.toISOString().split('T')[0];
      const toStr = to.toISOString().split('T')[0];

      const response = await fetch(
        `${FMP_BASE_URL}/historical-price-full/${symbol}?from=${fromStr}&to=${toStr}&apikey=${FMP_API_KEY}`
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

// Unified quote function that handles both regular stocks and mutual funds
export async function getQuote(symbol: string): Promise<Quote | null> {
  if (isMutualFund(symbol)) {
    const cnbcQuote = await getMutualFundQuote(symbol);
    if (cnbcQuote) {
      return {
        currentPrice: cnbcQuote.price,
        previousClose: cnbcQuote.previousClose,
        changePercent: cnbcQuote.changePercent,
      };
    }
    return null;
  }
  return getFMPQuote(symbol);
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();

  // Separate mutual funds from regular stocks
  const mutualFunds = symbols.filter(isMutualFund);
  const regularStocks = symbols.filter((s) => !isMutualFund(s));

  // Fetch mutual funds via CNBC (in parallel)
  const mutualFundPromises = mutualFunds.map(async (symbol) => {
    const quote = await getMutualFundQuote(symbol);
    if (quote) {
      results.set(symbol, {
        currentPrice: quote.price,
        previousClose: quote.previousClose,
        changePercent: quote.changePercent,
      });
    }
  });

  // Fetch regular stocks via FMP batch endpoint
  const [fmpQuotes] = await Promise.all([
    getMultipleFMPQuotes(regularStocks),
    Promise.all(mutualFundPromises),
  ]);

  // Merge FMP results
  for (const [symbol, quote] of fmpQuotes) {
    results.set(symbol, quote);
  }

  return results;
}

