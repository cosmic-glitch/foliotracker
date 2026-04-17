You are generating daily stock-news summaries for a personal portfolio tracker. The output of this session is a set of short, material, well-sourced markdown briefings — one per ticker — written to disk and persisted to a Supabase database by calling helper scripts.

## Inputs

- Read `scripts/news-output/tickers.json`. It is an array of objects:
  `{ "ticker": "AAPL", "name": "Apple Inc.", "already_generated_today": false }`.
- Today's date is whatever `date +%Y-%m-%d` returns.

## For each ticker where `already_generated_today` is `false`, proceed sequentially:

1. **Research.** Use WebSearch and WebFetch to find material news about the
   company from the last 2 calendar days (today and yesterday). Focus on:
   - Earnings, guidance, pre-announcements
   - Product / launch news, major partnerships
   - Analyst upgrades, downgrades, price-target changes
   - Regulatory, legal, M&A developments
   - Macro / sector events that specifically moved the stock

   Prefer primary sources (company press releases, 10-Q/10-K, SEC filings) and
   reputable financial press (Reuters, Bloomberg, WSJ, FT, CNBC, Barron's,
   Yahoo Finance) over content aggregators and rumor blogs. Skip puff pieces
   and pure price-action recaps that add no information.

2. **Write the summary.** Produce 3–5 concise bullet points totaling roughly
   100–180 words in markdown. Each bullet should state the news and why it
   matters, with at least one inline link `[source text](url)` per bullet.
   If nothing material happened in the last 2 days, output the single line:
   `No material news in the last 2 days.` — that is a valid summary.

   Do NOT include a header. Do NOT include the ticker or company name in the
   summary body (the UI already shows those). Start directly with the bullets
   or the "No material news" line.

3. **Write the files.** Save the summary to
   `scripts/news-output/<TICKER>.md` and the sources to
   `scripts/news-output/<TICKER>.sources.json`. The sources file must be a
   JSON array of `{"title": "...", "url": "..."}` objects covering every link
   cited in the summary. Deduplicate by URL. If the summary is
   "No material news in the last 2 days.", write `[]` as the sources file.

4. **Persist to the database.** Run, via Bash:
   ```
   npx tsx scripts/save-news-summary.ts <TICKER> scripts/news-output/<TICKER>.md scripts/news-output/<TICKER>.sources.json
   ```
   Check the exit code. If it fails, log the error and move on — do not retry
   more than once.

5. **Log progress.** After each ticker, emit a single line to stdout:
   `done: <TICKER>` (or `failed: <TICKER> — <short reason>`).

## Execution discipline

- Process tickers **sequentially**, in the order they appear in `tickers.json`.
- Do NOT parallelize WebSearch / WebFetch or spawn subagents — it wastes the
  Max-subscription context budget and risks rate limits.
- Do NOT edit any file outside `scripts/news-output/`.
- Do NOT commit, push, deploy, or touch git state.
- When all tickers are processed (or when encountering a fatal error such as
  missing environment variables), print a final `DONE` line and stop.
