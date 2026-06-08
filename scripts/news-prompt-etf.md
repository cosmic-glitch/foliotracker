You are generating a weekly news digest for ETFs or mutual funds held in a personal portfolio tracker. The bar is higher than for single stocks: most weeks an ETF should produce no entry, because the dashboard already shows per-stock digests for its underlying holdings. The output is per-ticker markdown written to disk and persisted to Supabase by a helper script.

## Inputs

- Read `scripts/news-output/etf-tickers.json`. It is an array of objects:
  `{ "ticker": "VOO", "name": "Vanguard S&P 500 ETF", "already_generated_today": false }`.
- Today's date is whatever `date +%Y-%m-%d` returns. Treat "the last 7
  days" as today plus the previous 6 calendar days.

## For each ticker where `already_generated_today` is `false`, proceed sequentially:

1. **Research.** Use WebSearch and WebFetch to find material news about
   the fund **published in the last 7 calendar days**. Prefer issuer
   releases (Vanguard / BlackRock / State Street press rooms, fund
   prospectuses, SEC filings) and reputable financial press (Reuters,
   Bloomberg, WSJ, FT, CNBC, Barron's) over aggregators and rumor blogs.

2. **Apply the ETF materiality bar.** The default outcome is
   `No material news in the last 7 days.` — for a diversified ETF that is
   the right answer most weeks. Reach for bullets only when something
   fund-specific or sharply ETF-defining happened.

   **INCLUDE** (material at the fund level):
   - **Fund-level corporate actions**: expense ratio change, distribution
     or dividend change outside historical norms, share split or reverse
     split, fund liquidation or merger, share-class changes, conversion
     to/from a mutual fund.
   - **Index methodology / reconstitution events** that visibly shift the
     fund's composition (e.g., a 25/50 cap mechanic re-balances weights,
     an added/removed sub-industry, an index-provider change).
   - **Sharp ETF-level moves** where the ETF itself moved ≥3% intraday
     with an identifiable, fund-relevant catalyst — record sector moves,
     factor blowups, macro prints that whipsawed the whole basket. The
     bullet must explain the catalyst, not just the price action.
   - **Notable flow / AUM milestones**: record single-day inflow or
     outflow, AUM crossing a round number that headlines noticed, ranking
     change vs. peers.
   - **Regulatory or SEC actions** affecting the fund: SEC settlement,
     prospectus change, exemptive-relief grants, fund-of-funds inclusion
     changes.
   - **Issuer-level news** that materially affects this specific fund:
     Vanguard / BlackRock / State Street corporate action, lawsuit, or
     board / PM change for an actively-managed fund.
   - **Top-holding event so large it defined the fund's week** (e.g., a
     single holding ≥10% of the fund had an event that drove ≥3% of the
     ETF's price). Write the bullet from the ETF's POV ("Slid ~6% as
     AVGO Q3 AI guide miss tanked the SOX -10%"), not as a restatement
     of the underlying.

   **EXCLUDE** (not material enough or too duplicative):
   - **Holding-by-holding rehashes.** If the only news is "ETF held NVDA
     which rose on its product launch," skip it — the per-stock digest
     covers it.
   - Routine quarterly/monthly distributions within historical norms.
   - Generic technical analysis, price-target pieces, or rotation
     think-pieces ("VGT could rally", "ETFs to buy now").
   - "Tech ETFs rallied broadly" stories that name the fund in passing.
   - Marketing copy, "best ETFs" listicles, fund-flow recaps that show
     no out-of-pattern signal.
   - Generic Fed / macro days where this ETF moved roughly with the
     broad market and there is no fund-specific angle.

3. **Write the digest.** If material news exists, produce a markdown
   bullet list of **1–5 bullets, sorted newest date first**. Each bullet
   follows this shape:

   ```markdown
   - **MMM DD**: punchy headline of what happened [source](url).
   ```

   - Date prefix is the date the event actually broke, formatted as
     `**MMM DD**` (e.g., `**Jun 03**`). Do NOT backfill every bullet to
     today's date.
   - **One fact per bullet.** If two material events happened, write two
     bullets — do NOT compress them into a single bullet with a semicolon
     or "and…" clause.
   - **Body target: ~50–110 chars.** Write like a Bloomberg ticker
     headline: active voice, strong lead verb ("Slid", "Crossed",
     "Cut", "Added"), concrete numbers. Include the investor-relevant
     consequence only if it fits inside the budget.
   - At least one inline `[label](url)` citation per bullet; up to two if
     a second source strengthens the claim.
   - Do NOT include the ticker or fund name in the bullet body — the
     UI prefixes that.
   - Cap at 5 bullets even in extreme weeks. If more than 5 material
     events occurred, pick the most material.

   Good examples (illustrative — do not copy verbatim):
   ```markdown
   - **Jun 03**: First ETF ever to cross $1T AUM after a ~$1.7B single-day inflow [Bloomberg](https://…).
   - **Jun 05**: Slid ~6% as Broadcom AI guide miss tanked SOX -10%; hot payrolls drove 10Y to 4.54% [CNBC](https://…).
   - **Feb 02**: Expense ratio cut to 0.02% from 0.03% in Vanguard's 53-fund fee reduction [Vanguard](https://…).
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

- Process tickers **sequentially**, in the order they appear in `etf-tickers.json`.
- Do NOT parallelize WebSearch / WebFetch or spawn subagents — it wastes the
  Max-subscription context budget and risks rate limits.
- Do NOT edit any file outside `scripts/news-output/`.
- Do NOT commit, push, deploy, or touch git state.
- When all tickers are processed (or when encountering a fatal error such as
  missing environment variables), print a final `DONE` line and stop.
