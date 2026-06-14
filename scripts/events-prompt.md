You are generating an **Upcoming Events** feed for a personal multi-portfolio
stock tracker. The output renders on the public landing page, directly below
the "Top movers" strip: a short, forward-looking list of the market events most
worth knowing about over the next couple of weeks. It answers "what's coming
that could move my stuff?" the way the movers strip answers "what moved today?"

There are two kinds of events:

1. **Macro** — scheduled US macroeconomic releases and decisions that move the
   whole market (CPI, PCE, jobs report, FOMC decision, etc.). Universal; not
   tied to any one portfolio.
2. **Earnings** — a company **held by one or more public portfolios** reporting
   results soon. Portfolio-specific; carries the holder handles.

The output of this session is a single ranked `events.json` (plus a
human-readable `events.md` preview) written to disk. The wrapper
(`generate-events.sh`) persists `events.json` to the `upcoming_events` table
afterward via `scripts/save-events.ts` — your job is just to produce a correct,
well-formed `events.json`.

## Inputs

- Read `scripts/events-output/holdings.json`. It is an array of:
  `{ "ticker": "ADBE", "name": "Adobe Inc.", "holders": ["av","gs","vp"], "holder_count": 3 }`,
  already sorted most-held first. These are the only tickers whose earnings you
  should surface (they are the publicly-visible holdings — never research a
  ticker that is not in this file).
- Today's date is whatever `date +%Y-%m-%d` returns. Define two windows:
  - **Macro window:** today through today + 14 calendar days.
  - **Earnings window:** today through today + 21 calendar days.

## Step 1 — Macro calendar (research once, not per ticker)

Use WebSearch / WebFetch to find scheduled US macro events in the **macro
window**. Prefer authoritative calendars (BLS, BEA, Federal Reserve, Census
Bureau release schedules; Investing.com / TradingEconomics / MarketWatch
economic calendars as secondary). For each event capture the **exact release
date** and, when published, the time (almost always ET).

**INCLUDE** (high / medium importance):
- FOMC rate decision, statement, SEP/dot-plot, and the Powell presser
- CPI, Core CPI
- PCE / Core PCE (the Fed's preferred gauge)
- Jobs report (nonfarm payrolls + unemployment rate)
- PPI
- Retail sales
- GDP (advance / second / third estimates)
- ISM Manufacturing / Services PMI
- JOLTS job openings
- University of Michigan / Conference Board consumer sentiment (medium)
- Major Treasury auctions or debt-ceiling / shutdown deadlines **only** if
  market-moving and widely covered

**EXCLUDE:** minor or thinly-watched series (e.g. wholesale inventories, weekly
EIA petroleum status, regional Fed indices) unless an unusual event makes one
genuinely market-moving. Weekly jobless claims: include **only** if nothing
else lands that day and it is a notably watched print; otherwise skip.

Assign `importance`:
- `high` — FOMC decision, CPI, PCE, jobs report.
- `medium` — PPI, retail sales, GDP, ISM, JOLTS, sentiment.
- `low` — everything else you chose to include.

Note on display: the landing-page strip currently shows **only high-importance
macro** (plus all held-stock earnings); medium/low macro is generated and stored
for the record but hidden in the UI. Classify honestly — don't inflate a release
to `high` just to surface it — but lean toward including the genuinely
market-moving prints, since those are the macro events that will actually show.

## Step 2 — Earnings (per held ticker)

Walk `holdings.json` in order. For each ticker, use WebSearch / WebFetch to find
the **next scheduled earnings date**. Prefer the company IR page or a reliable
earnings calendar (Nasdaq, Yahoo Finance, MarketBeat, Zacks). Note whether the
date is **confirmed** or **estimated**, and the session (`before open` /
`after close`) when stated.

- If the next earnings date falls **inside the earnings window**, emit an event.
- If it is further out, or the ticker has no earnings (it is an ETF / fund —
  e.g. an S&P 500 tracker mislabeled as a stock), **skip it silently**. Most
  mega-caps will be outside the window most of the time; that is expected. A
  quiet earnings list is correct, not a failure.
- `importance` for earnings = breadth-driven: `high` if `holder_count >= 4`,
  `medium` if 2–3, `low` if 1. (A widely-held name reporting matters more to
  this audience than a single-holder name.)

## Step 3 — Write `events.json`

A single JSON array, **sorted by `date` ascending**, then by importance
(high→low), then by `holder_count` descending. Each element:

```json
{
  "id": "fomc-2026-06-17",
  "type": "macro",
  "date": "2026-06-17",
  "time": "14:00 ET",
  "title": "Fed rate decision (FOMC)",
  "detail": "Fed concludes its June meeting; updated dot plot + Powell presser.",
  "importance": "high",
  "tickers": [],
  "holders": null,
  "holder_count": 0,
  "source": { "title": "Federal Reserve", "url": "https://www.federalreserve.gov/..." }
}
```

For earnings, `type: "earnings"`, `tickers: ["ADBE"]`, `holders: ["av","gs","vp"]`,
`holder_count: 3`, and fold confirmed/estimated + session into `detail`, e.g.
`"Q2 FY26 results after close (confirmed). Held by av, gs, vp."`

Field rules:
- `id`: stable slug — `"<type>-<ticker-or-series>-<date>"` lowercased.
- `date`: ISO `YYYY-MM-DD`, the day the event occurs.
- `time`: ET clock time, `"before open"`, `"after close"`, or `null` if unknown.
- `title`: **≤ 32 characters — a hard limit.** The strip renders each title on a
  single line in a narrow mobile column; anything longer is clipped. Brevity is
  therefore the top constraint — say it in the shortest form that still reads
  clearly, and judge for yourself how best to fit the meaning in that space.
  Within the budget, prefer plain language a non-expert grasps: lead with the
  plain meaning and append the acronym in parentheses **only if it still fits**;
  if it doesn't, keep just the acronym people actually recognize (CPI, PCE, GDP,
  FOMC). The event's **date is already shown in its own column**, so do NOT repeat
  the month/period in the title — put the reporting period in `detail` instead.
  Aim for ~24–30 chars; treat 32 as the ceiling, not the target:
    - "FOMC" → `"Fed rate decision (FOMC)"`
    - "May PCE inflation" → `"Fed's inflation gauge (PCE)"`
    - "May CPI" → `"Consumer inflation (CPI)"`
    - "May PPI" → `"Wholesale inflation (PPI)"`
    - "May jobs report" → `"Jobs report (payrolls)"`
    - "Q1 GDP third estimate" → `"Economic growth (GDP)"`
    - "May retail sales" → `"Retail sales"`
    - "ISM Manufacturing PMI" → `"Manufacturing PMI (ISM)"`
    - "JOLTS job openings" → `"Job openings (JOLTS)"`
  Earnings titles stay **self-contained and name the company** (no ticker chip
  precedes them): `"<Company> Q# FY## earnings"`, e.g. `"Micron Q3 FY26 earnings"`,
  `"Adobe Q2 FY26 earnings"` — a short, recognizable company name, not the ticker.
  To fit 32 chars, shorten the name to its common form (e.g. "TSMC", not "Taiwan
  Semiconductor"); if still over, drop the fiscal year ("Q3 earnings") before the
  quarter, and only then trim further.
- `detail`: one sentence, ≤ 140 chars. The "why it matters" / specifics.
- `tickers`: `[]` for macro; the reporting ticker(s) for earnings.
- `holders` / `holder_count`: `null` / `0` for macro; copied from the input for
  earnings.
- `source`: one `{title,url}` you actually verified the date against.

Cap the list at **12 events**. If more qualify, drop the lowest-importance,
lowest-breadth, furthest-out ones first, and note what you dropped in stdout.

## Step 4 — Write `events.md` (preview only)

A human-readable rendering so the date/grouping is easy to eyeball. Group by
date, e.g.:

```markdown
## Upcoming events — generated 2026-06-13

### Mon Jun 15
- 🟡 **Retail sales** — 8:30 ET. May read on the consumer post-tariffs.

### Wed Jun 17
- 🔴 **Fed rate decision (FOMC)** — 14:00 ET. Dot plot + Powell presser.

### Thu Jun 18
- 📊 **Adobe Q2 FY26 earnings** — after close, confirmed. Held by av, gs, vp.
```

Use 🔴 high / 🟡 medium / ⚪ low for macro, and 📊 for earnings. Keep it terse.

## Execution discipline

- Write **only** inside `scripts/events-output/`. Do not touch any other file.
- Do NOT commit, push, deploy, or touch git state.
- Process tickers sequentially; do not spawn subagents.
- Every date in the output must be one you verified against a real source this
  run — no dates from memory. If you cannot confirm a ticker's next earnings
  date, skip it rather than guess.
- When done, print a one-line summary: `EVENTS: <n macro> macro, <n earnings>
  earnings, dropped <k>` and stop.
