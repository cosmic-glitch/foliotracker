# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep this file in sync — and lean.** Update it in the same commit as any change that alters what it describes, but only record what a fresh session could NOT derive by glancing at the code: cross-file gotchas, external state, deliberate-but-surprising behavior. Design rationale and layout detail belong in code comments next to the code. Verify behavior against the code before documenting it, and prune whenever you touch a section — this file loads into every session, so every paragraph has a permanent context cost.

## Overview

FolioTracker is a multi-portfolio stock tracker: React + Vite + Tailwind frontend (`src/`), Vercel serverless API (`api/`, shared libs in `api/_lib/`), Supabase Postgres, Upstash Redis cache. Data fetching is React Query via hooks in `src/hooks/`. **Live URL:** https://foliotracker.pro

Standard Vite scripts (see `package.json`). `npm run dev` serves the frontend only — the `api/` functions don't run locally, so API-backed features need a deployment.

Non-obvious spots in the file map:
- `api/portfolios.ts` does more than CRUD: it also serves the analytics dashboard data (`?action=analytics`), computes the landing-page movers (`movers: { regular, extended }`), and returns `viewsToday`
- `api/_lib/redis.ts`: `portfolio`/`portfolios`/`history`/`holdings-history` read Redis first, fall back to Supabase (metadata/list/count backfill on a miss; snapshot misses don't); the snapshot refresh writes through. `api/permissions.ts` only *invalidates* Redis
- `api/refresh-prices.ts` is a legacy manual endpoint (`REFRESH_SECRET` auth) — the VM cron replaced its schedule
- `api/_lib/openai.ts` is **dead code**: `scripts/generate-research.ts` defines its own `generateDeepResearch`, sharing only the prompt from `api/_lib/prompts.ts`

## Data model (Supabase)

Tables (schema details in `api/_lib/db.ts` and `scripts/migrate-*.ts`): `portfolios`, `holdings`, `portfolio_viewers`, `price_cache`, `daily_prices`, `fundamentals_cache`, `portfolio_snapshots` (pre-computed JSONB), `sessions`, `share_links`, `analytics_events`, `ticker_news_summaries`, `upcoming_events`, `holdings_history` (append-only edit log). Gotchas: `upcoming_events.importance` is written as a constant and unread by the UI; `portfolios.allocation_public` is a boolean separate from `visibility` (see Auth).

External data: **Yahoo Finance** (quotes/history/news, free, no key) and **companiesmarketcap.org** for fundamentals — the latter is our own service, running on the same Hetzner VM with a daily FMP-backed refresh.

## Key patterns

- Holdings are "tradeable" (shares × price) or "static" (fixed value); `instrument_type` drives the "By Type" panel
- **Market calendar**: market-open state is NYSE-calendar-aware (holidays, 1 p.m. half-days). The two constants `MARKET_HOLIDAYS`/`MARKET_EARLY_CLOSES` are **duplicated verbatim** in `api/_lib/cache.ts` and `src/lib/market-hours.ts` (separate build targets — change both; `npx playwright test calendar-sync` guards drift, manual only, not in CI). They also gate the trading-date helpers, so the 1D window and NAV-stale reset are holiday-correct. Seeded through 2028 — extend from nyse.com before that runs out. Holiday/weekend day-change intentionally shows the last completed session's move (Yahoo `range=1d` returns the prior session)
- **Stale-NAV reset**: once-daily-NAV funds (Mutual Fund / Money Market) would show yesterday's day change during the next session; `applyDailyNavStaleReset` (`snapshot.ts`) sets `previousClose = currentPrice` after the open (`isDailyNavStale` in `cache.ts`, keyed on the quote's `regularMarketTime`) so the change reads 0. It rewrites `previousClose` — not just the change — because `usePortfolioData` recomputes day change client-side when Extended Hours is off. Funds-only portfolios thus read a hard 0% intraday, so `isDayChangeUnknown` (`api/portfolios.ts`) flags them and the landing page shows "—" in 1D mode and drops them from the leader calc (detail page still shows 0%)
- **Snapshot + Redis**: reads serve **Redis → snapshot → empty placeholder**. Create/edit **awaits** a snapshot refresh before responding (errors swallowed; the save still succeeds)
- **Fundamentals share-class aliasing**: companiesmarketcap.org serves one canonical class per company; `FUNDAMENTALS_SHARE_CLASS_ALIASES` (`snapshot.ts`) copies to sibling tickers (per-share fields scaled, ratios as-is). If a ticker's fundamentals fossilize, probe which class the site serves now — history in the comment at that constant
- **PE tab**: trailing PE arrives ready-made (`peRatio`, non-positive → null); forward PEs are price ÷ forward EPS computed in `snapshot.ts`. Default sort next-FY forward PE asc, nulls last
- **Movers strip**: ranked √holder-breadth × |move| in `computeMarketMovers`; includes portfolios with `visibility === 'public'` **or** `allocation_public` (default true) — private portfolios with the flag still contribute tickers. The sync-required constants (`DISPLAY_COUNT`/`MOVER_MIN_COUNT`, `MoverFundamentals` interface, `w-36` tab width across the three landing cards) are flagged by comments at each site
- **Upcoming events strip**: `save-events.ts` ranks deterministically (**date asc → macro before earnings → holder_count desc → id asc**) into `position`; `api/events.ts` serves today-or-future rows in that order; UI shows the first 1. Titles capped at 32 chars (`save-events.ts` warns); earnings titles rewritten to ticker form at display time
- **Holdings history**: `recordHoldingsHistory` diffs holdings on create/edit — best-effort, never blocks the save. Only investment-material rows are kept: cost-basis-only edits aren't logged, and static rename pairs (remove + add at equal value) are dropped at write time (`dropStaticRenames`, `db.ts`) and again at read time (`materialSessions`, `src/utils/holdingsHistory.ts`) for legacy rows; the same util backfills `prev_static_value` (null before migration 012) from each ticker's earlier rows. `api/holdings-history.ts` attaches `price` per tradeable row (daily close on/before the ET record date, `price_cache` fallback) so the UI can show ~dollar amounts. Served to anyone who can see dollar values (same gating as `api/portfolio.ts`); allocation-only viewers get 403 → `[]` → the Changes tab hides. Direct-DB edits bypass the log
- **Three independent AI features**: news (`generate-news.sh` cron → `ticker_news_summaries` → `api/news.ts`, Yahoo fallback), events (`generate-events.sh` cron → `upcoming_events` → `api/events.ts`), deep research (`scripts/generate-research.ts` → `portfolios.deep_research`)
- **Analytics events**: `log-view` writes `'view'` only; `'login'` comes exclusively from `api/login.ts`. `portfolio_id = null` ⇒ landing page; `viewer_id = null` ⇒ anonymous (clustered by IP alone in the Viewer Activity panel). `?share=<token>` resolves to `share_link_id`, powering the Shared Link Access panel (`computeShareLinkAccess` — all-time, active links only, ignores the `days` window and Include-AV toggle)
- **Storage-backed hooks must hydrate synchronously** (a `useState` lazy initializer reading storage, never a post-mount `useEffect`) — a post-mount hydrate makes the first render anonymous and silently broke view attribution for weeks

## Auth & permissions

- Portfolio login = password (bcrypt) → session token; login state in localStorage (`useLoggedInPortfolio`)
- Visibility: `public` / `private` / `selective` (owner + invited viewers)
- `allocation_public` (boolean, default true) is orthogonal: non-public portfolios with it set appear on the landing page in allocation-only form and feed the movers breadth
- **Admin override is a hardcoded bcrypt hash** (`ADMIN_HASH`, duplicated in `api/portfolios.ts`, `api/login.ts`, `api/_lib/db.ts` — change all three); it grants any private portfolio and gates `/analytics`. The `ADMIN_PASSWORD` env var is read by nothing

## Environment

Vars are listed in `.env.example` → copy to `.env.local` (gitignored); `source .env.local` before local scripts. Gotchas: the doubled `UPSTASH_REDIS_REST_KV_REST_` prefix comes from the Vercel integration (not a typo); `ADMIN_PASSWORD` is unused (see Auth); `SUPABASE_DB_URL` is the direct postgres connection for migrations/backups.

## Hetzner VM & crons

Reachable at `ssh av@myhetzner` (Tailscale). Jobs run via user crontab wrapped in `$HOME/bin/hc-run <slug> <cmd>` (healthchecks.io alerting). Install steps: `scripts/VM_SETUP.md`.

| Job | Schedule (UTC) | Script |
|---|---|---|
| Snapshot refresh | every minute live-session, else :00/:30 (self-gated) | `scripts/refresh-snapshots.sh` → `.ts` (`--force` bypasses gating) |
| News generation | daily 05:50 | `scripts/generate-news.sh` (`claude -p` per asset class) |
| Events generation | Sundays 07:30 | `scripts/generate-events.sh` (`claude -p` → `save-events.ts`) |
| DB backup | 06:30 every 3rd day | `scripts/backup-db.sh` (30-day retention; also runs locally) |

Wrappers self-sync via `git pull --ff-only origin main`; the news/events jobs need `claude` on `PATH`.

## Ops one-liners

```bash
source .env.local && npx tsx scripts/run-migration.ts                       # migrations (pg against SUPABASE_DB_URL; idiom in scripts/migrate-*.ts)
source .env.local && npx tsx scripts/generate-research.ts <id|--all>        # deep research (o4-mini-deep-research, background mode, polls ≤30 min, typ. 5–15)
source .env.local && npx tsx scripts/reset-password.ts <id> <new_password>  # re-hash + invalidate sessions
```

## Workflow

- **Build-only by default**: after changes, run `npm run build`. Don't deploy unless asked.
- **Deployment = git push**: the Vercel GitHub integration auto-deploys every push to `main` to production — "commit and push" IS the deploy. Manual `vercel` CLI deploys are a fallback only.
- **Build costs**: Standard build machine + on-demand concurrency disabled = $0/minute.
