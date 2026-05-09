# Share Portfolio via URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can mint time-bounded share URLs that grant any URL holder full read-only owner-equivalent access to a portfolio, regardless of the portfolio's visibility setting.

**Architecture:** A new `share_links` table holds tokens with expiry/revocation metadata. Three new owner-authenticated endpoints (`POST` / `GET` / `DELETE` on `/api/share-links`) manage links. Existing `GET /api/portfolio` and `GET /api/history` accept a new `share_token` query parameter; a valid token bypasses visibility checks and returns the same payload an authenticated owner gets. The portfolio page detects `?share=<token>` in the URL and forwards it to API calls (read-only mode hides owner controls). Owners manage links from a new "Share" panel on the edit page.

**Tech Stack:** TypeScript, Vercel Functions, Supabase Postgres (`pg` for migrations), React 19, react-router-dom v7, @tanstack/react-query, Tailwind 4, Playwright

**Refinement vs. spec:** The spec proposed `x-share-token` HTTP header. This plan uses `?share_token=<token>` query param instead, to match the existing pattern (`?token=...`, `?password=...`) used by the codebase's other endpoints. The browser-visible URL still uses the shorter `?share=<token>` form for ergonomics; the frontend translates it.

**Reference spec:** `docs/superpowers/specs/2026-05-09-share-via-url-design.md`

---

## File structure

### Files to create
- `scripts/migrate-share-links.ts` — DB migration creating the `share_links` table
- `api/share-links.ts` — list/mint/revoke management endpoint
- `src/components/SharePanel.tsx` — UI panel for owners (rendered inside `EditPortfolio.tsx`)
- `tests/share-link.spec.ts` — Playwright e2e covering mint → access → revoke → 401

### Files to modify
- `api/_lib/db.ts` — add `DbShareLink` type and CRUD helpers (`createShareLink`, `listShareLinks`, `getShareLinkByToken`, `revokeShareLink`)
- `api/portfolio.ts` — accept `share_token` query param; if valid, bypass visibility checks
- `api/history.ts` — same treatment as `api/portfolio.ts`
- `src/hooks/usePortfolioData.ts` — accept optional `shareToken` and forward as `share_token` query param on all three fetches
- `src/App.tsx` — extract `?share=<token>` from URL and pass to `usePortfolioData`; add 401-fallback effect to drop the param when the token is rejected. Owner-only controls are already gated by `loggedInAs === portfolioId` and need no further changes.
- `src/pages/EditPortfolio.tsx` — render `<SharePanel portfolioId={...} ownerToken={token} />` below the existing visibility section

---

## Task 1: Add `share_links` table migration

**Files:**
- Create: `scripts/migrate-share-links.ts`

This task establishes the database schema. The script can be run multiple times safely (`IF NOT EXISTS` guards) and must verify the resulting schema before exiting.

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-share-links.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * Create share_links table for time-bounded portfolio share URLs.
 */

import pg from 'pg';

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('Error: SUPABASE_DB_URL must be set');
    console.error('Run: source .env.local');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  console.log('Connecting to database...');
  await client.connect();

  console.log('Running migration...');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS share_links (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        portfolio_id TEXT         NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
        token        TEXT         NOT NULL UNIQUE,
        label        TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ  NOT NULL,
        revoked_at   TIMESTAMPTZ
      )
    `);
    console.log('  Created share_links table (or already existed)');

    await client.query(`
      CREATE INDEX IF NOT EXISTS share_links_token_idx ON share_links (token)
    `);
    console.log('  Created share_links_token_idx');

    await client.query(`
      CREATE INDEX IF NOT EXISTS share_links_portfolio_id_idx ON share_links (portfolio_id)
    `);
    console.log('  Created share_links_portfolio_id_idx');

    // Verify
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'share_links'
      ORDER BY ordinal_position
    `);

    console.log('\nVerification:');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable=${row.is_nullable})`);
    }

    if (result.rows.length !== 7) {
      throw new Error(`Expected 7 columns, found ${result.rows.length}`);
    }

    console.log('\nMigration successful!');
    await client.end();
  } catch (error) {
    console.error('Migration failed:', error);
    await client.end();
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Run the migration**

Run: `source .env.local && npx tsx scripts/migrate-share-links.ts`

Expected output ends with `Migration successful!` and the verification block lists exactly 7 columns: `id`, `portfolio_id`, `token`, `label`, `created_at`, `expires_at`, `revoked_at`.

- [ ] **Step 3: Verify idempotency**

Run the same command a second time. It must succeed again with the same output (no errors about duplicate tables/indexes).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-share-links.ts
git commit -m "Add share_links table migration"
```

---

## Task 2: Add `share_links` DB helpers

**Files:**
- Modify: `api/_lib/db.ts` (append after the existing `deleteExpiredSessions` helper around line 259)

These helpers wrap CRUD on the new table and centralize the validity rule (`revoked_at IS NULL AND expires_at > now()`).

- [ ] **Step 1: Add types and helpers to `api/_lib/db.ts`**

Append the following block to `api/_lib/db.ts`. Place it just after the existing `deleteExpiredSessions` function (the new section is logically a peer of the session helpers):

```typescript
// Share link types and functions
export interface DbShareLink {
  id: string;
  portfolio_id: string;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export async function createShareLink(
  portfolioId: string,
  durationDays: number,
  label: string | null
): Promise<DbShareLink> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('share_links')
    .insert({
      portfolio_id: portfolioId.toLowerCase(),
      token,
      label,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as DbShareLink;
}

export async function listShareLinks(portfolioId: string): Promise<DbShareLink[]> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .eq('portfolio_id', portfolioId.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as DbShareLink[];
}

export async function getShareLinkByToken(token: string): Promise<DbShareLink | null> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .eq('token', token)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return (data as DbShareLink) || null;
}

export async function revokeShareLink(id: string, portfolioId: string): Promise<boolean> {
  // Scoped to portfolioId to prevent cross-portfolio revocation by a leaked id.
  const { data, error } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('portfolio_id', portfolioId.toLowerCase())
    .is('revoked_at', null)
    .select('id');

  if (error) throw error;
  return !!data && data.length > 0;
}

export function isShareLinkValid(link: DbShareLink): boolean {
  if (link.revoked_at) return false;
  if (new Date(link.expires_at) <= new Date()) return false;
  return true;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/db.ts
git commit -m "Add share_links CRUD helpers"
```

---

## Task 3: API endpoint — `POST /api/share-links` (mint)

**Files:**
- Create: `api/share-links.ts`

We're creating one file that handles all three verbs. This task wires up `POST` only; `GET` and `DELETE` follow in tasks 4 and 5.

- [ ] **Step 1: Create `api/share-links.ts` with POST handler**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authenticateRequest,
  createShareLink,
  getPortfolio,
} from './_lib/db.js';

interface MintBody {
  portfolioId?: string;
  durationDays?: number;
  label?: string;
  token?: string;
  password?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = (req.body || {}) as MintBody;
      const portfolioId = body.portfolioId?.toLowerCase();
      const durationDays = body.durationDays;
      const label = body.label?.trim() || null;

      if (!portfolioId) {
        res.status(400).json({ error: 'portfolioId is required' });
        return;
      }
      if (!Number.isInteger(durationDays) || (durationDays as number) < 1) {
        res.status(400).json({ error: 'durationDays must be a positive integer' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const { authenticated } = await authenticateRequest(
        portfolioId,
        body.token,
        body.password
      );
      if (!authenticated) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const link = await createShareLink(portfolioId, durationDays as number, label);

      res.status(201).json({
        id: link.id,
        token: link.token,
        label: link.label,
        createdAt: link.created_at,
        expiresAt: link.expires_at,
        revokedAt: link.revoked_at,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Share-links API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add api/share-links.ts
git commit -m "Add POST /api/share-links mint endpoint"
```

---

## Task 4: API endpoint — `GET /api/share-links` (list)

**Files:**
- Modify: `api/share-links.ts`

Append a `GET` branch above the `POST` branch in the handler. List endpoint returns all rows for the portfolio (including revoked/expired) so the UI can show their state.

- [ ] **Step 1: Add the GET handler**

In `api/share-links.ts`, add a new import and a new branch. Update the imports at the top:

```typescript
import {
  authenticateRequest,
  createShareLink,
  getPortfolio,
  listShareLinks,
} from './_lib/db.js';
```

Insert a new `if (req.method === 'GET')` block immediately inside the `try {` and before the `if (req.method === 'POST')` block:

```typescript
    if (req.method === 'GET') {
      const portfolioId = (req.query.portfolioId as string)?.toLowerCase();
      const token = req.query.token as string | undefined;
      const password = req.query.password as string | undefined;

      if (!portfolioId) {
        res.status(400).json({ error: 'portfolioId is required' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const { authenticated } = await authenticateRequest(portfolioId, token, password);
      if (!authenticated) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const links = await listShareLinks(portfolioId);
      res.status(200).json({
        links: links.map((l) => ({
          id: l.id,
          token: l.token,
          label: l.label,
          createdAt: l.created_at,
          expiresAt: l.expires_at,
          revokedAt: l.revoked_at,
        })),
      });
      return;
    }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add api/share-links.ts
git commit -m "Add GET /api/share-links list endpoint"
```

---

## Task 5: API endpoint — `DELETE /api/share-links` (revoke)

**Files:**
- Modify: `api/share-links.ts`

- [ ] **Step 1: Add the DELETE handler**

Update imports in `api/share-links.ts`:

```typescript
import {
  authenticateRequest,
  createShareLink,
  getPortfolio,
  listShareLinks,
  revokeShareLink,
} from './_lib/db.js';
```

Insert a new `if (req.method === 'DELETE')` block right after the existing `POST` block:

```typescript
    if (req.method === 'DELETE') {
      const id = (req.query.id as string) || (req.body && (req.body as { id?: string }).id);
      const portfolioId = ((req.query.portfolioId as string) || (req.body && (req.body as { portfolioId?: string }).portfolioId))?.toLowerCase();
      const token = (req.query.token as string) || (req.body && (req.body as { token?: string }).token);
      const password = (req.query.password as string) || (req.body && (req.body as { password?: string }).password);

      if (!id || !portfolioId) {
        res.status(400).json({ error: 'id and portfolioId are required' });
        return;
      }

      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) {
        res.status(404).json({ error: 'Portfolio not found' });
        return;
      }

      const { authenticated } = await authenticateRequest(portfolioId, token, password);
      if (!authenticated) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const revoked = await revokeShareLink(id, portfolioId);
      if (!revoked) {
        res.status(404).json({ error: 'Share link not found or already revoked' });
        return;
      }

      res.status(200).json({ ok: true });
      return;
    }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification of all three endpoints**

Deploy a preview: `vercel`

Set env vars locally for the test:
```bash
export PREVIEW_URL=<the preview URL from vercel output>
export PORTFOLIO_ID=<a portfolio id you own>
export PASSWORD=<that portfolio's password>
```

Mint a link:
```bash
curl -s -X POST "$PREVIEW_URL/api/share-links" \
  -H "Content-Type: application/json" \
  -d "{\"portfolioId\":\"$PORTFOLIO_ID\",\"durationDays\":1,\"label\":\"smoke test\",\"password\":\"$PASSWORD\"}"
```
Expected: `201` with body `{ id, token, label: "smoke test", createdAt, expiresAt, revokedAt: null }`. Save the `id` and `token` values for the next steps.

List links:
```bash
curl -s "$PREVIEW_URL/api/share-links?portfolioId=$PORTFOLIO_ID&password=$PASSWORD"
```
Expected: `200` with `{ links: [{...}] }` containing the link minted above.

Revoke:
```bash
curl -s -X DELETE "$PREVIEW_URL/api/share-links?id=<the-id>&portfolioId=$PORTFOLIO_ID&password=$PASSWORD"
```
Expected: `200` with `{ ok: true }`.

List again:
```bash
curl -s "$PREVIEW_URL/api/share-links?portfolioId=$PORTFOLIO_ID&password=$PASSWORD"
```
Expected: same link, but with `revokedAt` now non-null.

Try to revoke without auth:
```bash
curl -s -X DELETE "$PREVIEW_URL/api/share-links?id=<the-id>&portfolioId=$PORTFOLIO_ID"
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add api/share-links.ts
git commit -m "Add DELETE /api/share-links revoke endpoint"
```

---

## Task 6: Wire `share_token` into `GET /api/portfolio`

**Files:**
- Modify: `api/portfolio.ts:304-345` (the visibility-auth block)

When a valid `share_token` is supplied, treat the request as authenticated (`authResult.authenticated = true`) and skip the existing private/selective gates. Invalid tokens return `401`.

- [ ] **Step 1: Add helper import and shareToken handling**

In `api/portfolio.ts`, update the import on line 2 to add `getShareLinkByToken` and `isShareLinkValid`:

```typescript
import { getPortfolio, verifyPortfolioPassword, authenticateRequest, isAllowedViewer, getPortfolioViewers, getPortfolioSnapshot, getCachedPrices, getPortfolioAIComments, getChatHistory, addChatMessage, clearChatHistory, getTodayChatCount, getShareLinkByToken, isShareLinkValid, type Visibility } from './_lib/db.js';
```

Replace lines 304-317 (the block from `// Handle visibility-based authentication` through the existing `authenticateRequest` block, ending just before `if (portfolio.visibility === 'private')`) with this:

```typescript
    // Handle visibility-based authentication
    const token = req.query.token as string;
    const password = req.query.password as string;
    const shareToken = req.query.share_token as string;
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();

    let authResult = { authenticated: false, isAdmin: false };

    // Share token: if present, validate and short-circuit visibility checks.
    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      authResult = { authenticated: true, isAdmin: false };
    } else if (token || password) {
      authResult = await authenticateRequest(portfolioId, token, password);
      if ((token || password) && !authResult.authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }
```

The existing `if (portfolio.visibility === 'private')` and `else if (portfolio.visibility === 'selective')` blocks below are unchanged; they now correctly accept share-token requests because `authResult.authenticated === true`.

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification**

Deploy: `vercel`

Pick a `private` portfolio you own. Mint a share link via Task 5's curl recipe and capture the `token`.

Confirm baseline (private portfolio without auth) returns `requiresAuth: true`:
```bash
curl -s "$PREVIEW_URL/api/portfolio?id=$PORTFOLIO_ID" | jq '.requiresAuth'
```
Expected: `true`.

With share token, full payload:
```bash
curl -s "$PREVIEW_URL/api/portfolio?id=$PORTFOLIO_ID&share_token=<token>" | jq '.holdings | length'
```
Expected: a positive integer (the holdings array is populated).

With a bogus share token, `401`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$PREVIEW_URL/api/portfolio?id=$PORTFOLIO_ID&share_token=deadbeef"
```
Expected: `401`.

After revoking the link via Task 5's curl, the same valid token should now `401`:
```bash
curl -s -X DELETE "$PREVIEW_URL/api/share-links?id=<link-id>&portfolioId=$PORTFOLIO_ID&password=$PASSWORD"
curl -s -o /dev/null -w "%{http_code}\n" "$PREVIEW_URL/api/portfolio?id=$PORTFOLIO_ID&share_token=<token>"
```
Expected: `200` for the revoke, then `401`.

- [ ] **Step 4: Commit**

```bash
git add api/portfolio.ts
git commit -m "Honor share_token on GET /api/portfolio"
```

---

## Task 7: Wire `share_token` into `GET /api/history`

**Files:**
- Modify: `api/history.ts:2`, `api/history.ts:77-85`

Same shape as Task 6, applied to the history endpoint.

- [ ] **Step 1: Update imports**

Replace line 2 of `api/history.ts` with:

```typescript
import { getPortfolio, getPortfolioSnapshot, authenticateRequest, isAllowedViewer, getShareLinkByToken, isShareLinkValid } from './_lib/db.js';
```

- [ ] **Step 2: Add shareToken handling**

In `api/history.ts`, find the block that begins `// Handle visibility-based authentication` (around line 77) and ends just before `if (portfolio.visibility === 'private')` (around line 86). Replace it with:

```typescript
    // Handle visibility-based authentication
    const shareToken = req.query.share_token as string;
    let authResult = { authenticated: false, isAdmin: false };

    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      authResult = { authenticated: true, isAdmin: false };
    } else if (token || password) {
      authResult = await authenticateRequest(portfolioId, token, password);
      if ((token || password) && !authResult.authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }
```

Note: `token` and `password` are already declared earlier in this handler (lines 47-48); do not redeclare them.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

Deploy: `vercel`

Mint a fresh share link (the one from Task 6 may be revoked). Then:

```bash
curl -s "$PREVIEW_URL/api/history?id=$PORTFOLIO_ID&days=30&share_token=<token>" | jq '.data | length'
```
Expected: positive integer.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$PREVIEW_URL/api/history?id=$PORTFOLIO_ID&days=30&share_token=deadbeef"
```
Expected: `401`.

- [ ] **Step 5: Commit**

```bash
git add api/history.ts
git commit -m "Honor share_token on GET /api/history"
```

---

## Task 8: Forward `shareToken` from `usePortfolioData`

**Files:**
- Modify: `src/hooks/usePortfolioData.ts:82-141, 145`

Add an optional `shareToken` parameter that's threaded through all three fetch helpers as `share_token` query param, and into the React Query keys so token changes trigger refetches.

- [ ] **Step 1: Update fetch helpers and hook signature**

In `src/hooks/usePortfolioData.ts`, update each fetch helper to accept a `shareToken` parameter and append it to the URL. Replace the three `fetch*Api` functions (lines 82-141) with:

```typescript
async function fetchPortfolioApi(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
): Promise<ApiPortfolioResponse | PrivatePortfolioResponse | null> {
  const url = new URL(`${API_BASE_URL}/api/portfolio`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  if (shareToken) url.searchParams.set('share_token', shareToken);

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Invalid password');
  if (!response.ok) throw new Error('Failed to fetch portfolio');
  return response.json();
}

async function fetchHistoryApi(
  portfolioId: string,
  days: number,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
): Promise<ApiHistoryResponse> {
  const url = new URL(`${API_BASE_URL}/api/history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  url.searchParams.set('days', days.toString());
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  if (shareToken) url.searchParams.set('share_token', shareToken);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

async function fetchIntradayApi(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
): Promise<ApiHistoryResponse> {
  const url = new URL(`${API_BASE_URL}/api/history`, window.location.origin);
  url.searchParams.set('id', portfolioId);
  url.searchParams.set('interval', '1m');
  if (token) url.searchParams.set('token', token);
  if (loggedInAs) url.searchParams.set('logged_in_as', loggedInAs);
  if (shareToken) url.searchParams.set('share_token', shareToken);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch intraday data');
  return response.json();
}
```

- [ ] **Step 2: Update `usePortfolioData` signature and queries**

Replace the `usePortfolioData` line on line 145 with this signature, and update the three `useQuery` calls to include `shareToken` in their keys and call the fetch helpers with it. Find the existing `export function usePortfolioData` block and modify it as follows:

```typescript
export function usePortfolioData(
  portfolioId: string,
  token?: string | null,
  loggedInAs?: string | null,
  shareToken?: string | null
) {
  const queryClient = useQueryClient();
  const [chartView, setChartView] = useState<ChartView>('1D');
  const { showExtendedHours } = useExtendedHours();

  const portfolioQuery = useQuery({
    queryKey: [...portfolioKeys.detail(portfolioId), token ?? 'no-auth', loggedInAs ?? 'no-login', shareToken ?? 'no-share'],
    queryFn: () => fetchPortfolioApi(portfolioId, token, loggedInAs, shareToken),
    enabled: !!portfolioId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: () => isLiveMarketSession() ? 60 * 1000 : 30 * 60 * 1000,
    refetchIntervalInBackground: true,
  });

  const historyQuery = useQuery({
    queryKey: [...portfolioKeys.history(portfolioId), token ?? 'no-auth', loggedInAs ?? 'no-login', shareToken ?? 'no-share'],
    queryFn: () => fetchHistoryApi(portfolioId, MAX_DAYS, token, loggedInAs, shareToken),
    enabled: !!portfolioId && !!portfolioQuery.data && chartView === '30D',
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const intradayQuery = useQuery({
    queryKey: [...portfolioKeys.intraday(portfolioId), token ?? 'no-auth', loggedInAs ?? 'no-login', shareToken ?? 'no-share'],
    queryFn: () => fetchIntradayApi(portfolioId, token, loggedInAs, shareToken),
    enabled: !!portfolioId && !!portfolioQuery.data && (chartView === '1D' || isLiveMarketSession()),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: () => isLiveMarketSession() ? 60 * 1000 : false,
  });
```

The rest of the function (memo blocks, return value) is unchanged.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePortfolioData.ts
git commit -m "Forward shareToken through usePortfolioData"
```

---

## Task 9: Read `?share=<token>` in `App.tsx` and forward it

**Files:**
- Modify: `src/App.tsx:1` (import), `src/App.tsx:37-62` (component setup), and add an `useEffect` for the 401 fallback

The frontend translates the user-facing `?share=<token>` URL param into the API-call `share_token` parameter. The existing `Header` component already gates owner controls on `loggedInAs === portfolioId.toLowerCase()` (see `src/App.tsx:138`), so a share-token recipient who is not logged in as this portfolio will already not see those controls — no separate gating needed.

What we DO need:
1. Read `?share=<token>` from the URL and pass it to `usePortfolioData`.
2. If the share token is rejected (API returns 401), drop the `?share=` param from the URL so the existing visibility flow can take over (instead of leaving the user on a broken-looking page).

- [ ] **Step 1: Update the React import**

Replace line 1 of `src/App.tsx`:

```typescript
import { useEffect, useState } from 'react';
```

- [ ] **Step 2: Read the share token and pass it to the hook**

In `src/App.tsx`, find the `usePortfolioData` call (around lines 51-62) and the lines just above it. Insert the share token read between the `storedToken` declaration and the `usePortfolioData` call, and add `shareToken` as the fourth argument:

```typescript
  // Get stored token if portfolio was previously unlocked OR if logged in as this portfolio
  const storedToken = portfolioId
    ? (getToken(portfolioId) || (loggedInAs === portfolioId.toLowerCase() ? getLoginToken() : null))
    : null;

  // Share token from URL — set when someone visits /portfolioId?share=<token>
  const shareToken = new URLSearchParams(window.location.search).get('share');

  const {
    data,
    isLoading,
    isHistoryLoading,
    isRefreshing,
    error,
    requiresAuth,
    chartView,
    setChartView,
    showExtendedHours,
    refresh,
  } = usePortfolioData(portfolioId || '', storedToken, loggedInAs, shareToken);
```

- [ ] **Step 3: Add 401-fallback effect**

Add this effect immediately after the `usePortfolioData` destructuring block (still inside `App()`):

```typescript
  // If the share token was rejected (server returned 401 → React Query threw "Invalid password"),
  // drop the share param from the URL so the normal visibility flow takes over instead of
  // showing the user a stuck "Invalid password" error banner.
  useEffect(() => {
    if (!shareToken) return;
    if (error === 'Invalid password') {
      const url = new URL(window.location.href);
      url.searchParams.delete('share');
      window.location.replace(url.toString());
    }
  }, [shareToken, error]);
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "Honor ?share=<token> URL param in portfolio view"
```

---

## Task 10: Build the `SharePanel` component

**Files:**
- Create: `src/components/SharePanel.tsx`

A self-contained component that fetches/lists/mints/revokes share links for one portfolio, given the owner's session token.

- [ ] **Step 1: Create the component**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link2, Copy, Trash2, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface Props {
  portfolioId: string;
  ownerToken: string;
}

function shareUrl(portfolioId: string, token: string): string {
  return `${window.location.origin}/${portfolioId}?share=${token}`;
}

function statusFor(link: ShareLink): { text: string; tone: 'active' | 'revoked' | 'expired' } {
  if (link.revokedAt) return { text: 'Revoked', tone: 'revoked' };
  if (new Date(link.expiresAt) <= new Date()) return { text: 'Expired', tone: 'expired' };
  const ms = new Date(link.expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return { text: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'active' };
}

export function SharePanel({ portfolioId, ownerToken }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [daysInput, setDaysInput] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
      url.searchParams.set('portfolioId', portfolioId);
      url.searchParams.set('token', ownerToken);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load share links');
      const body = await res.json();
      setLinks(body.links || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load share links');
    } finally {
      setLoading(false);
    }
  }, [portfolioId, ownerToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    const days = parseInt(daysInput, 10);
    if (!Number.isInteger(days) || days < 1) {
      setError('Duration must be a positive whole number of days');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/api/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId,
          durationDays: days,
          label: labelInput.trim() || undefined,
          token: ownerToken,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create share link');
      }
      const created = (await res.json()) as ShareLink;
      const url = shareUrl(portfolioId, created.token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(created.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        // Clipboard may be unavailable; ignore.
      }
      setLabelInput('');
      setDaysInput('1');
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(shareUrl(portfolioId, link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  const handleRevoke = async (link: ShareLink) => {
    try {
      const url = new URL(`${API_BASE_URL}/api/share-links`, window.location.origin);
      url.searchParams.set('id', link.id);
      url.searchParams.set('portfolioId', portfolioId);
      url.searchParams.set('token', ownerToken);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to revoke');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke share link');
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-text-secondary" />
        <h3 className="text-sm font-medium text-text-primary">Share via link</h3>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Anyone with the link can view this portfolio (read-only) until it expires.
      </p>

      {/* Create form */}
      <div className="space-y-2 mb-4">
        <input
          type="text"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="Label (optional)"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
          />
          <span className="text-sm text-text-secondary self-center">days</span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting}
            className="ml-auto bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Generate link
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-negative mb-3">{error}</p>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-text-secondary">No share links yet.</p>
      ) : (
        <div className="bg-background rounded-lg border border-border divide-y divide-border">
          {links.map((link) => {
            const status = statusFor(link);
            const isActive = status.tone === 'active';
            return (
              <div key={link.id} className={`flex items-center gap-3 px-3 py-2 ${isActive ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    {link.label || 'Untitled link'}
                  </p>
                  <p className="text-xs text-text-secondary">{status.text}</p>
                </div>
                {isActive && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopy(link)}
                      title="Copy URL"
                      className="p-1 hover:bg-card-hover rounded transition-colors"
                    >
                      <Copy className={`w-4 h-4 ${copiedId === link.id ? 'text-accent' : 'text-text-secondary'}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(link)}
                      title="Revoke"
                      className="p-1 hover:bg-negative/10 hover:text-negative rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-text-secondary hover:text-negative" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/SharePanel.tsx
git commit -m "Add SharePanel component"
```

---

## Task 11: Render `SharePanel` inside `EditPortfolio`

**Files:**
- Modify: `src/pages/EditPortfolio.tsx` (add import + render below the visibility section)

- [ ] **Step 1: Add the import**

In `src/pages/EditPortfolio.tsx`, add this import next to the other component imports near the top:

```typescript
import { SharePanel } from '../components/SharePanel';
```

- [ ] **Step 2: Render the panel below the visibility block**

Find the closing `</div>` of the "Visibility" section (around line 636 in the current file — the `<div className="bg-card rounded-xl border border-border p-4">` block whose first label is "Who can view this portfolio?"). Insert immediately after it, before the "Submit" comment:

```tsx
          {/* Share via link */}
          {portfolioId && token && (
            <SharePanel portfolioId={portfolioId} ownerToken={token} />
          )}
```

The guard ensures we only render when we have both pieces; the surrounding component already redirects to `/` if `!token` (line 68-71), so in practice the guard will always pass on this page.

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual UI smoke**

Deploy: `vercel`

Open `<preview-url>/<portfolioId>/edit` for a portfolio you own. (If you're not currently logged into the portfolio, log in via the password modal on the portfolio page first.)

- Verify the "Share via link" panel renders below the visibility section.
- Type a label, set days to `1`, click "Generate link".
- Verify a row appears in the list, the URL is copied to your clipboard (paste somewhere to confirm), and the form clears.
- Open the copied URL in a private browser window. Verify the portfolio renders with all owner-equivalent data, no edit/delete UI is visible, and there is no password prompt.
- Back on the edit page, click the trash icon to revoke. Verify the row dims and shows "Revoked".
- Refresh the private-window tab. Verify the URL no longer grants access (either falls back to the password screen for a `private` portfolio, or — if visibility is `public` — the share param is dropped and the page renders normally).

- [ ] **Step 5: Commit**

```bash
git add src/pages/EditPortfolio.tsx
git commit -m "Render SharePanel on EditPortfolio page"
```

---

## Task 12: Playwright e2e — share link round-trip

**Files:**
- Create: `tests/share-link.spec.ts`

The Playwright config points at `https://foliotracker.vercel.app` by default but supports overriding `baseURL` via `PLAYWRIGHT_BASE_URL` env var. We'll write the test against the deployed preview by setting that var.

This test covers the round trip: minting via API → loading the share URL in a browser → revoking via API → confirming the URL no longer works.

The test requires a test portfolio. Reuse the existing `av` portfolio (already used by `tests/refresh.spec.ts`) — but mint and revoke share links via API only, not the UI, to keep the test resilient to small UI changes.

- [ ] **Step 1: Write the test**

Create `tests/share-link.spec.ts`:

```typescript
import { test, expect, request } from '@playwright/test';

const PORTFOLIO_ID = process.env.SHARE_TEST_PORTFOLIO_ID || 'av';
const PORTFOLIO_PASSWORD = process.env.SHARE_TEST_PASSWORD;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://foliotracker.vercel.app';

test.describe('Share via URL', () => {
  test.skip(
    !PORTFOLIO_PASSWORD,
    'Set SHARE_TEST_PASSWORD (and optionally SHARE_TEST_PORTFOLIO_ID, PLAYWRIGHT_BASE_URL) to run.'
  );

  test('mint, view via URL, revoke', async ({ page }) => {
    const api = await request.newContext({ baseURL: BASE_URL });

    // Mint a share link via the API
    const mintRes = await api.post('/api/share-links', {
      data: {
        portfolioId: PORTFOLIO_ID,
        durationDays: 1,
        label: 'playwright e2e',
        password: PORTFOLIO_PASSWORD,
      },
    });
    expect(mintRes.status()).toBe(201);
    const { id, token } = await mintRes.json();
    expect(typeof id).toBe('string');
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);

    // Load the share URL in a fresh browser context — no localStorage from the owner session
    await page.goto(`/${PORTFOLIO_ID}?share=${token}`);
    await expect(page.getByText('Total Portfolio Value')).toBeVisible({ timeout: 20000 });

    // Revoke the share link
    const revokeRes = await api.delete(
      `/api/share-links?id=${id}&portfolioId=${PORTFOLIO_ID}&password=${encodeURIComponent(PORTFOLIO_PASSWORD!)}`
    );
    expect(revokeRes.status()).toBe(200);

    // Hitting the same URL via the API now returns 401
    const portfolioRes = await api.get(`/api/portfolio?id=${PORTFOLIO_ID}&share_token=${token}`);
    expect(portfolioRes.status()).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test against a deployed preview**

```bash
vercel  # capture the preview URL it prints
export PLAYWRIGHT_BASE_URL=<preview-url>
export SHARE_TEST_PORTFOLIO_ID=<your test portfolio id>
export SHARE_TEST_PASSWORD=<that portfolio's password>
npx playwright test tests/share-link.spec.ts
```

Expected: test passes.

If `av` portfolio is `public`, the share URL still works — the test only checks that the page loads and that the token is later rejected. Pick a portfolio you have the password for.

- [ ] **Step 3: Commit**

```bash
git add tests/share-link.spec.ts
git commit -m "Add Playwright e2e for share-link round trip"
```

---

## Task 13: Final smoke + ship

- [ ] **Step 1: Final manual smoke against a fresh preview**

Run: `vercel`

Open the preview URL and walk through the full flow as a real user would:

1. Visit a portfolio you own. Log in.
2. Click "Edit". The Share panel is visible.
3. Generate a link with no label, 7 days.
4. Open the URL in a private window. Confirm: portfolio loads, all data visible, no edit/delete buttons, no password prompt.
5. Generate a second link with label "test 2", 1 day. Confirm both links appear in the list.
6. Revoke the first link. Confirm the private window with the first URL now requires auth (or for a public portfolio, simply drops the `?share=` param and renders normally).
7. The second link still works.
8. Visit the portfolio without `?share=` — owner-side experience is unchanged.

- [ ] **Step 2: Confirm with the user before promoting to prod**

Per `CLAUDE.md`: never deploy to prod without explicit user approval. Stop here, share the preview URL, and wait for the user to say "ship it" before running `vercel --prod`.
