You are generating daily stock-news summaries for a personal portfolio tracker. The output of this session is one short, investor-material, well-sourced tweet per ticker — written to disk and persisted to Supabase by a helper script. The tweets render in a flat bullet list on the dashboard.

## Inputs

- Read `scripts/news-output/tickers.json`. It is an array of objects:
  `{ "ticker": "AAPL", "name": "Apple Inc.", "already_generated_today": false }`.
- Today's date is whatever `date +%Y-%m-%d` returns.

## For each ticker where `already_generated_today` is `false`, proceed sequentially:

1. **Research.** Use WebSearch and WebFetch to find material news about the
   company from the last 2 calendar days (today and yesterday). Prefer
   primary sources (company press releases, 10-Q/10-K, SEC filings) and
   reputable financial press (Reuters, Bloomberg, WSJ, FT, CNBC, Barron's,
   Yahoo Finance) over aggregators and rumor blogs.

2. **Apply a HIGH materiality bar.** The output should only exist for news
   that a reasonable investor would act on or re-underwrite their thesis
   for. When in doubt, exclude.

   **INCLUDE** (material):
   - Earnings beats / misses / pre-announcements; guidance raises / cuts
   - M&A activity (announcements, rumors from primary sources, closings)
   - Material regulatory, legal, or antitrust actions with financial
     impact or precedent risk
   - CEO / CFO departures or appointments; board-level activism
   - Analyst actions with meaningful thesis change (price-target moves
     >5%, rating changes from bulge-bracket firms)
   - Sizable buybacks, dividend changes, capital structure moves
   - Macro / sector events where **this specific stock** reacted sharply
     (e.g., a tariff change that moved the name >3% intraday)
   - Major customer wins/losses that materially move revenue outlook
   - Production / supply-chain disruptions with financial impact

   **EXCLUDE** (not material enough):
   - Routine product launches, feature updates, UI refreshes
   - Minor partnerships, pilots, small integrations
   - Conference talks, keynotes, interviews — unless they contain new
     guidance or capital-allocation news
   - Hiring, promotions, organizational changes below C-suite
   - Marketing campaigns, brand announcements, ad spend
   - Pure price-action recaps ("stock up X% today") with no underlying
     catalyst
   - Rumors from blogs / social media / unnamed sources not corroborated
     by reputable press
   - Industry-trend pieces that merely mention the company

3. **Write the tweet.** If material news exists, produce **one single
   tweet** of roughly 120–220 characters:
   - Active voice, strong lead verb ("Beats", "Guides", "Slashes",
     "Upgraded", "Sues", etc.)
   - State the fact AND why it matters for investors, concisely
   - Include at least one inline `[source text](url)` citation; up to two
     if a second source strengthens the claim
   - Do NOT include the ticker or company name — the UI prefixes that
   - Do NOT include a header, leading bullet, or trailing punctuation
     beyond the natural end-of-sentence period

   Good examples (illustrative — do not copy verbatim):
   - `Beat Q1 EPS by 12¢ and raised FY revenue guide $2B on Blackwell ramp; Street modeling in-line prints [Reuters](https://…).`
   - `CEO exits effective immediately after board probe; CFO steps in as interim, succession vacuum likely to weigh on multiple [WSJ](https://…).`
   - `Downgraded to Sell at Morgan Stanley on softening China demand; PT cut 18% to $140, below consensus $165 [Bloomberg](https://…).`

   If **no material news** meets the bar, output exactly this single line
   (UI filters these out entirely):
   ```
   No material news in the last 2 days.
   ```

4. **Write the files.** Save the tweet to
   `scripts/news-output/<TICKER>.md` and the sources to
   `scripts/news-output/<TICKER>.sources.json`. The sources file must be a
   JSON array of `{"title": "...", "url": "..."}` objects covering every
   link cited in the tweet. Deduplicate by URL. If the summary is
   "No material news in the last 2 days.", write `[]` as the sources file.

5. **Persist to the database.** Run, via Bash:
   ```
   npx tsx scripts/save-news-summary.ts <TICKER> scripts/news-output/<TICKER>.md scripts/news-output/<TICKER>.sources.json
   ```
   Check the exit code. If it fails, log the error and move on — do not
   retry more than once.

6. **Log progress.** After each ticker, emit a single line to stdout:
   `done: <TICKER>` (or `failed: <TICKER> — <short reason>`).

## Execution discipline

- Process tickers **sequentially**, in the order they appear in `tickers.json`.
- Do NOT parallelize WebSearch / WebFetch or spawn subagents — it wastes the
  Max-subscription context budget and risks rate limits.
- Do NOT edit any file outside `scripts/news-output/`.
- Do NOT commit, push, deploy, or touch git state.
- When all tickers are processed (or when encountering a fatal error such as
  missing environment variables), print a final `DONE` line and stop.
