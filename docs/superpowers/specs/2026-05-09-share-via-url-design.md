# Share Portfolio via URL — Design

**Date:** 2026-05-09
**Status:** Approved (design); pending implementation plan

## Summary

Portfolio owners can mint time-bounded share links that grant any URL holder read-only, owner-equivalent access to a portfolio — regardless of the portfolio's visibility setting. Each link is a long random token embedded in the URL; possession of the URL is the only credential. Owners can mint multiple concurrent links per portfolio, label them, and revoke any of them at any time.

## Goals

- Let owners share a portfolio with someone who doesn't have the password and shouldn't be added as a permanent viewer.
- Time-bound the access (default 1 day, owner-chosen number of days).
- Allow concurrent links per portfolio with independent expirations and revocation.
- Reuse existing visibility/auth infrastructure where possible.

## Non-goals

- No write/edit access via share links.
- No partial views (e.g., "hide cost basis"). Recipient sees the same data as the owner.
- No per-recipient identity tracking (the link is a bearer token, not tied to a person).
- No max-duration cap. Owner can pick any number of days.

## Flow

1. Owner logs into their portfolio and visits the edit page.
2. In a new "Share" panel, they fill out an optional label and a number of days, then click "Generate". Server mints a token and returns the full share URL.
3. Owner copies the URL and sends it to whoever.
4. Recipient opens the URL — `/<portfolioId>?share=<token>` — and sees the portfolio as the owner sees it, minus edit/delete controls.
5. Owner can revoke any link from the same panel before its natural expiry.

## Data model

New table `share_links`:

| column | type | notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `portfolio_id` | `text` foreign key → `portfolios.id`, `on delete cascade` | |
| `token` | `text` unique, indexed | 64-char hex from `crypto.randomBytes(32)` |
| `label` | `text` nullable | owner's optional note ("for Mom") |
| `created_at` | `timestamptz` not null default `now()` | |
| `expires_at` | `timestamptz` not null | |
| `revoked_at` | `timestamptz` nullable | |

A link is **valid** iff `revoked_at IS NULL AND expires_at > now()`.

Expired rows are kept (audit trail, cheap). Revisit if the table grows materially.

## API surface

### Management endpoints (owner-authenticated)

All require the existing portfolio session token (from `api/login.ts`) for the target portfolio. Admin sessions also pass.

- `GET /api/share-links?portfolioId=<id>` — list all links for the portfolio (active + revoked + expired), most-recent first. Used by the "Share" panel.
- `POST /api/share-links` — body `{ portfolioId, durationDays, label? }`. Validates `durationDays` is a positive integer. Mints `token`, computes `expires_at = now() + durationDays * 1 day`, inserts row, returns `{ id, token, url, label, expires_at }` where `url` is the full share URL.
- `DELETE /api/share-links?id=<id>` — sets `revoked_at = now()` (does not delete the row, so it stays in the list as "revoked"). Verifies the requesting session owns the parent portfolio before mutating.

### Read endpoints (token-authenticated)

Existing `GET /api/portfolio` and `GET /api/history` accept a new optional `x-share-token` header.

- If header present and token is valid for the requested portfolio → bypass the existing visibility check (`private`/`selective`) and return the owner-equivalent payload (same shape as logged-in-owner currently gets).
- If header present and token is invalid (revoked, expired, or unknown) → respond `401` with a body indicating "share token invalid or expired". The frontend treats this the same as no token and falls back to the normal visibility flow.
- If header absent → existing behavior unchanged.

Mutation endpoints (`POST/PUT/DELETE` on `/api/portfolios`, etc.) **do not** read the share token. The token is read-only end-to-end.

## UI

### Edit page — new "Share" panel

Sits below the existing visibility/viewers controls.

- **List of links**: rows showing label (or "Untitled link"), expiration ("expires in 3 days" or "expired" or "revoked"), `Copy` button (writes the full URL to clipboard), `Revoke` button. Revoked/expired rows are visually de-emphasized but stay visible until the user dismisses them.
- **Create new**: small form with `Label (optional)` text input, `Duration in days` number input (default `1`, min `1`), `Generate` button. On submit, the new link appears at the top of the list and the URL is auto-copied to the clipboard with a confirmation toast.

### Portfolio view — share-token mode

- The frontend extracts `?share=<token>` from the URL on mount. If present, all subsequent fetches to `/api/portfolio` and `/api/history` for this portfolio include the `x-share-token` header.
- Renders identically to the owner view (cost basis, gain/loss, AI research, all holdings) but hides edit/delete UI.
- Token is preserved across in-app navigation within the portfolio (e.g., changing date ranges).
- On `401` from the API: drop the share token from URL and let the existing visibility flow take over (e.g., the password screen for a private portfolio). Avoids leaking that the token "used to be valid".

## Security and edge cases

- **Token shape**: `crypto.randomBytes(32).toString('hex')` → 64-character hex string. Not bcrypt-hashed because we look up by value (bcrypt would force a full table scan per request) and the threat model is bearer-token possession, not offline cracking.
- **Token in URL**: appears in browser history, possibly in referrer headers. This is the inherent tradeoff of "possession of URL = access". Owners are warned implicitly by the panel copy ("anyone with this URL can view"); explicit warning text is OK to add.
- **Brute force**: 64-char hex (2^256) makes guessing infeasible. Rate-limit `401` responses on the read endpoints by IP as belt-and-suspenders. Confirm during implementation whether existing infra already rate-limits.
- **Revocation**: setting `revoked_at` is immediate; the next request from the recipient will get `401`. No need to invalidate caches because we validate per request.
- **Cascading deletes**: deleting a portfolio drops its share links via the foreign key.
- **Multiple visibility modes**: the share panel is shown on every edit page regardless of the portfolio's `visibility` value (`public`/`private`/`selective`). For `public` portfolios a share link is redundant but harmless.

## Testing

- **Unit**: token generation; validation logic across `(missing, valid, expired, revoked, unknown)` token states; row-level CRUD against Supabase.
- **Integration**: `GET /api/portfolio` and `GET /api/history` with each of the five token states × each of the three visibility modes (`public`/`private`/`selective`). Confirm mutation endpoints ignore the header.
- **Manual smoke**: mint a link → open in incognito → verify full owner-equivalent read-only view → revoke from owner session → verify recipient now hits the password screen (private case) or public view (public case).

## Out of scope / deferred

- Per-link analytics ("how many times was this link opened").
- Email/SMS delivery from inside the app — owner copies and pastes the URL themselves.
- Recipient identity (named recipients, "view as" tracking).
- Editable share links (changing duration after creation).
- Maximum duration cap (intentionally omitted; owner picks).

## Decisions log

These were called out during brainstorming and confirmed:

1. **Multiple concurrent links per portfolio** (vs. single regenerable link).
2. **Recipient sees the same view as owner**, read-only (vs. public-style masked view or per-link toggle).
3. **Revocable + managed in a "Share" panel on the edit page** (vs. no revocation, or modal from portfolio view).
4. **No max-duration cap** (vs. 7- or 30-day cap).
5. **Available on portfolios of any visibility** (vs. only `private`/`selective`).
6. **Stateless token-per-request** (vs. token-for-cookie exchange) — link survives tab close, token stays in URL.
7. **`?share=<token>` query param** (vs. `/share/<token>` path).
8. **Owner management endpoints reuse existing portfolio session** (vs. separate auth flow).
9. **Token stored as plaintext, not bcrypt-hashed** — required for direct lookup; threat model is bearer possession.
