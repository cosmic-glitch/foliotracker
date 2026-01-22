// scripts/fetch-news.ts
// Standalone script to test Yahoo Finance news fetching
//
// Usage:
//   npx tsx scripts/fetch-news.ts AAPL MSFT GOOGL
//   npx tsx scripts/fetch-news.ts AAPL --json

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const DELAY_BETWEEN_REQUESTS_MS = 200;

// News article interface
interface NewsArticle {
  title: string;
  publisher: string;
  link: string;
  publishedAt: Date;
  relatedTickers: string[];
}

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

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
  if (diffHours > 0) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffMins > 0) {
    return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
  }
  return 'just now';
}

// Fetch news from Yahoo Finance search endpoint
async function fetchYahooNews(ticker: string, directOnly: boolean = true): Promise<NewsArticle[]> {
  return await withRetry(async () => {
    // Request more articles so we have enough after filtering
    const newsCount = directOnly ? 25 : 10;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${newsCount}&quotesCount=0&listsCount=0`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Yahoo API error ${response.status} (will retry)`);
      }
      console.error(`Yahoo API error for ${ticker}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const newsItems = data.news || [];

    const articles = newsItems.map((item: {
      title?: string;
      publisher?: string;
      link?: string;
      providerPublishTime?: number;
      relatedTickers?: string[];
    }) => ({
      title: item.title || 'No title',
      publisher: item.publisher || 'Unknown',
      link: item.link || '',
      publishedAt: new Date((item.providerPublishTime || 0) * 1000),
      relatedTickers: item.relatedTickers || [],
    }));

    // Filter to only articles where ticker is the primary subject (first in relatedTickers)
    if (directOnly) {
      const filtered = articles.filter((article: NewsArticle) =>
        article.relatedTickers[0] === ticker
      );
      return filtered.slice(0, 10); // Return max 10
    }

    return articles;
  });
}

// Format and print news for a ticker
function printNewsForTicker(ticker: string, articles: NewsArticle[]): void {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`=== News for ${ticker} ===`);
  console.log('='.repeat(50));

  if (articles.length === 0) {
    console.log('\nNo news articles found.\n');
    return;
  }

  articles.forEach((article, index) => {
    console.log(`\n${index + 1}. ${article.title}`);
    console.log(`   Source: ${article.publisher} | ${formatRelativeTime(article.publishedAt)}`);
    console.log(`   ${article.link}`);
    if (article.relatedTickers.length > 0) {
      console.log(`   Related: ${article.relatedTickers.join(', ')}`);
    }
  });

  console.log('');
}

// Parse command line arguments
function parseArgs(): { tickers: string[]; jsonOutput: boolean; directOnly: boolean } {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const includeAll = args.includes('--all');
  const tickers = args.filter((arg) => !arg.startsWith('--')).map((t) => t.toUpperCase());

  return { tickers, jsonOutput, directOnly: !includeAll };
}

// Main function
async function main() {
  const { tickers, jsonOutput, directOnly } = parseArgs();

  if (tickers.length === 0) {
    console.log('Usage: npx tsx scripts/fetch-news.ts AAPL MSFT GOOGL [--json] [--all]');
    console.log('\nOptions:');
    console.log('  --json    Output results as JSON');
    console.log('  --all     Include all news (not just directly related articles)');
    process.exit(1);
  }

  const filterMsg = directOnly ? ' (directly related only)' : ' (all mentions)';
  console.log(`Fetching news for ${tickers.length} ticker(s): ${tickers.join(', ')}${filterMsg}\n`);

  const results: Record<string, NewsArticle[]> = {};

  for (const ticker of tickers) {
    try {
      const articles = await fetchYahooNews(ticker, directOnly);
      results[ticker] = articles;

      if (!jsonOutput) {
        printNewsForTicker(ticker, articles);
      }

      // Rate limiting between requests
      if (tickers.indexOf(ticker) < tickers.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
      }
    } catch (error) {
      console.error(`Error fetching news for ${ticker}:`, error);
      results[ticker] = [];
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  }

  // Summary
  if (!jsonOutput) {
    console.log('\n' + '='.repeat(50));
    console.log('Summary');
    console.log('='.repeat(50));
    for (const ticker of tickers) {
      const count = results[ticker].length;
      console.log(`${ticker}: ${count} article${count !== 1 ? 's' : ''}`);
    }
  }
}

main().catch(console.error);
