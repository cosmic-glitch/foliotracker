You are generating a weekly stock-news digest for a personal portfolio tracker. The output of this session is a short, dated bullet list per ticker covering material news from the last 7 days — written to disk and persisted to Supabase by a helper script. The dashboard renders one block per ticker.

## Inputs

- Read `scripts/news-output/tickers.json`. It is an array of objects:
  `{ "ticker": "AAPL", "name": "Apple Inc.", "already_generated_today": false }`.
- Today's date is whatever `date +%Y-%m-%d` returns. Treat "the last 7
  days" as today plus the previous 6 calendar days.

## For each ticker where `already_generated_today` is `false`, proceed sequentially:

1. **Research.** Use WebSearch and WebFetch to find material news about
   the company **published in the last 7 calendar days**. Prefer primary
   sources (company press releases, 10-Q/10-K, SEC filings) and reputable
   financial press (Reuters, Bloomberg, WSJ, FT, CNBC, Barron's, Yahoo
   Finance) over aggregators and rumor blogs.

2. **Apply a MEDIUM-HIGH materiality bar.** The goal is a weekly briefing
   a thoughtful long-term investor would actually read. **When in doubt,
   include** if the item could plausibly matter to the company's
   fundamentals, market position, or leadership narrative.

   **INCLUDE** (material):
   - Earnings, guidance, pre-announcements (beats, misses, raises, cuts)
   - M&A announcements or credible reports
   - Material regulatory, legal, or antitrust actions
   - CEO / CFO departures or appointments; board activism
   - **Any analyst rating change or price-target move from a bulge-bracket
     firm**, even if the PT change is small
   - Notable short-seller reports
   - Sizable buybacks, dividend changes, splits, capital structure moves
   - **Management interviews, conference talks, or shareholder letters**
     that contain thesis-relevant content (guidance hints, capital
     allocation shifts, strategic pivots, competitive commentary)
   - Significant customer wins/losses or contract announcements that
     move revenue outlook
   - **Major product launches** — new platforms, flagship generations,
     or categories with clear revenue implications (not refreshes)
   - Material supply-chain events (shortages, disruptions, new suppliers)
   - Macro / sector events where this specific stock reacted sharply
     (>3% intraday on the event day)
   - Strategic partnerships with meaningful financial impact

   **EXCLUDE** (not material enough):
   - Puff pieces, brand / marketing campaigns, ad spend stories
   - Hiring or promotions below C-suite
   - Pure feature refreshes, UI updates, minor version bumps
   - Pure price-action recaps with no underlying catalyst
   - Uncorroborated rumors from blogs / social media / unnamed sources
   - Industry-trend pieces that merely mention the company in passing

3. **Write the digest.** If material news exists, produce a markdown
   bullet list of **1–5 bullets, sorted newest date first**. Each bullet
   follows this shape:

   ```markdown
   - **MMM DD**: tweet-length statement of what happened and why it matters [source text](url).
   ```

   - Date prefix is the date the news actually broke, formatted as
     `**MMM DD**` (e.g., `**Apr 16**`). Do NOT backfill every bullet to
     today's date.
   - Each bullet body is ~120–220 chars: active voice, strong lead verb
     ("Beat", "Raised", "Downgraded", "Inked", "Sued"), state the fact
     AND the investor-relevant consequence.
   - At least one inline `[label](url)` citation per bullet; up to two if
     a second source strengthens the claim.
   - Do NOT include the ticker or company name in the bullet body — the
     UI prefixes that.
   - Cap at 5 bullets. If more than 5 material events occurred, pick the
     most material.

   Good examples (illustrative — do not copy verbatim):
   ```markdown
   - **Apr 16**: Beat Q1 EPS by 12¢ and raised FY revenue guide $2B on Blackwell ramp; Street was modeling in-line prints [Reuters](https://…).
   - **Apr 14**: Downgraded to Sell at Morgan Stanley on softening China demand; PT cut 18% to $140, below consensus $165 [Bloomberg](https://…).
   - **Apr 12**: CEO floated share-buyback acceleration on CNBC; $5B board authorization signals capital-return pivot as capex digests [CNBC](https://…).
   ```

   If **nothing material happened** in the last 7 days, output exactly
   this single line (UI filters these out entirely):
   ```
   No material news in the last 7 days.
   ```

4. **Write the files.** Save the digest to
   `scripts/news-output/<TICKER>.md` and the sources to
   `scripts/news-output/<TICKER>.sources.json`. The sources file must be
   a JSON array of `{"title": "...", "url": "..."}` objects covering
   every link cited in the digest. Deduplicate by URL. If the summary is
   "No material news in the last 7 days.", write `[]` as the sources
   file.

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
