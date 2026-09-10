import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPortfolio, authenticateRequest, getShareLinkByToken, isShareLinkValid, getHoldingsHistory, getHoldingsHistoryEntry, deleteHoldingsHistoryEntry, updateHoldingsHistoryEntry, isAllowedViewer, getDailyPrices, getCachedPrices, type DbHoldingsHistory } from './_lib/db.js';
import { getPortfolioFromRedis, setPortfolioInRedis, type CachedPortfolio } from './_lib/redis.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method === 'DELETE') {
    await handleDelete(req, res);
    return;
  }
  if (req.method === 'PATCH') {
    await handlePatch(req, res);
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const portfolioId = req.query.id as string;
    const token = req.query.token as string;
    const password = req.query.password as string;
    const shareToken = req.query.share_token as string;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);

    if (!portfolioId) {
      res.status(400).json({ error: 'Portfolio ID is required' });
      return;
    }

    // Resolve portfolio (Redis → DB)
    let portfolio: CachedPortfolio | null = await getPortfolioFromRedis(portfolioId);
    if (!portfolio) {
      const dbPortfolio = await getPortfolio(portfolioId);
      if (dbPortfolio) {
        await setPortfolioInRedis(dbPortfolio);
        portfolio = {
          id: dbPortfolio.id,
          display_name: dbPortfolio.display_name,
          created_at: dbPortfolio.created_at,
          is_private: dbPortfolio.is_private,
          visibility: dbPortfolio.visibility,
          allocation_public: dbPortfolio.allocation_public,
        };
      }
    }
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found' });
      return;
    }

    // Auth mirrors api/portfolio.ts: anyone who can see dollar values can see
    // the change log. That means public portfolios (no auth), owner/admin
    // token or password, invited viewers on selective portfolios, and full-mode
    // share links. Allocation-only viewers (allocation_only share link, or a
    // restricted viewer on an allocation_public portfolio) are denied — the
    // log carries share counts and static values, which are dollar data.
    const loggedInAs = (req.query.logged_in_as as string)?.toLowerCase();
    let authenticated = false;
    if (shareToken) {
      const link = await getShareLinkByToken(shareToken);
      if (!link || link.portfolio_id !== portfolioId.toLowerCase() || !isShareLinkValid(link)) {
        res.status(401).json({ error: 'Share link invalid or expired' });
        return;
      }
      if (link.mode === 'allocation_only') {
        res.status(403).json({ error: 'Changes require access to portfolio values', requiresAuth: true });
        return;
      }
      authenticated = true;
    } else if (token || password) {
      const result = await authenticateRequest(portfolioId, token, password);
      authenticated = result.authenticated;
      if (!authenticated) {
        res.status(401).json({ error: 'Invalid password' });
        return;
      }
    }

    let restricted = false;
    if (portfolio.visibility === 'private') {
      restricted = !authenticated;
    } else if (portfolio.visibility === 'selective') {
      const isViewer = !!loggedInAs && (await isAllowedViewer(portfolioId, loggedInAs));
      restricted = !authenticated && !isViewer;
    }
    if (restricted) {
      res.status(403).json({ error: 'Changes require access to portfolio values', requiresAuth: true });
      return;
    }

    const history = await getHoldingsHistory(portfolioId, limit);
    res.status(200).json({ history: await attachClosePrices(history) });
  } catch (error) {
    console.error('Holdings history API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE ?id=<portfolio>&entry_id=<row uuid>&token=… (or the same fields in a
// JSON body). Owner/admin only — the read-side rules above (public portfolio,
// invited viewer, share link) never grant deletion. Deleting a row is a plain
// row delete: it doesn't touch holdings, and the next save diffs against the
// holdings table, not this log, so future entries are unaffected.
async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const q = req.query[key];
      if (typeof q === 'string' && q) return q;
      const b = body[key];
      return typeof b === 'string' && b ? b : undefined;
    };
    const portfolioId = pick('id');
    const entryId = pick('entry_id');
    const token = pick('token');
    const password = pick('password');

    if (!portfolioId || !entryId) {
      res.status(400).json({ error: 'id and entry_id are required' });
      return;
    }
    if (!UUID_RE.test(entryId)) {
      res.status(400).json({ error: 'Invalid entry_id' });
      return;
    }
    if (!token && !password) {
      res.status(401).json({ error: 'Authentication required' });
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

    const deleted = await deleteHoldingsHistoryEntry(portfolioId, entryId);
    if (!deleted) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Holdings history delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH ?id=<portfolio>&entry_id=<row uuid> with a JSON body of
// { price_override?: number | null, note?: string | null, token?, password? }.
// Owner/admin only, like DELETE: it edits the log row, never holdings. A null
// price_override reverts to the EOD estimate; an empty/absent note clears it.
// Price corrections apply to tradeable rows — static rows carry their exact
// value, so price_override is rejected for them.
const NOTE_MAX_LENGTH = 60;

async function handlePatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const q = req.query[key];
      if (typeof q === 'string' && q) return q;
      const b = body[key];
      return typeof b === 'string' && b ? b : undefined;
    };
    const portfolioId = pick('id');
    const entryId = pick('entry_id');
    const token = pick('token');
    const password = pick('password');

    if (!portfolioId || !entryId) {
      res.status(400).json({ error: 'id and entry_id are required' });
      return;
    }
    if (!UUID_RE.test(entryId)) {
      res.status(400).json({ error: 'Invalid entry_id' });
      return;
    }
    if (!token && !password) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasPrice = 'price_override' in body;
    const hasNote = 'note' in body;
    if (!hasPrice && !hasNote) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    let priceOverride: number | null | undefined;
    if (hasPrice) {
      const raw = body.price_override;
      if (raw === null) {
        priceOverride = null;
      } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        priceOverride = raw;
      } else {
        res.status(400).json({ error: 'price_override must be a positive number or null' });
        return;
      }
    }

    let note: string | null | undefined;
    if (hasNote) {
      const raw = body.note;
      if (raw === null) {
        note = null;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.length > NOTE_MAX_LENGTH) {
          res.status(400).json({ error: `note must be at most ${NOTE_MAX_LENGTH} characters` });
          return;
        }
        note = trimmed === '' ? null : trimmed;
      } else {
        res.status(400).json({ error: 'note must be a string or null' });
        return;
      }
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

    if (priceOverride != null) {
      const target = await getHoldingsHistoryEntry(portfolioId, entryId);
      if (!target) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      if (target.is_static) {
        res.status(400).json({ error: 'price_override applies to tradeable entries only' });
        return;
      }
    }

    let updated: Awaited<ReturnType<typeof updateHoldingsHistoryEntry>>;
    try {
      updated = await updateHoldingsHistoryEntry(portfolioId, entryId, {
        ...(hasPrice ? { price_override: priceOverride } : {}),
        ...(hasNote ? { note } : {}),
      });
    } catch (e) {
      if (isMissingColumnError(e)) {
        console.error('[holdings_history] edit columns missing — run migration 013:', e);
        res.status(409).json({ error: 'Change-log editing is not enabled yet (pending migration)' });
        return;
      }
      throw e;
    }
    if (!updated) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.status(200).json({ entry: (await attachClosePrices([updated]))[0] });
  } catch (error) {
    console.error('Holdings history patch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function isMissingColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // PostgREST PGRST204 reports an unknown column as "Could not find the
  // '<col>' column ... in the schema cache". Match that signature (either new
  // column) — not the bare column name — so unrelated errors that merely
  // mention one (overflow, a future check constraint) still surface as 500s.
  return /Could not find the '(?:price_override|note)' column|PGRST204|42703/.test(msg);
}

const ET_DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Attach `price` to each tradeable row: the owner's corrected price when one
// is set (`price_override`), else the EOD-close estimate below. `estimated_price`
// always carries the un-overridden estimate so the edit dialog can show what
// clearing the field reverts to. The FE turns share deltas into ~dollar
// amounts with the estimate (no `~` for a correction). The actual fill price
// isn't logged, so the estimate is explicitly an approximation: the ticker's
// close on the ET calendar day the change was recorded (or the last close
// before it, for weekends and holidays). Falls back to price_cache when
// daily_prices has nothing on or before that day (a same-day edit before the
// first snapshot refresh lands), and null when neither exists. Static rows
// carry their own value and get nulls. `price_override`/`note` are normalized
// to null for rows logged before migration 013.
async function attachClosePrices(
  history: DbHoldingsHistory[]
): Promise<Array<DbHoldingsHistory & { price: number | null; estimated_price: number | null }>> {
  const tradeable = history.filter((h) => !h.is_static);
  if (tradeable.length === 0)
    return history.map((h) => ({
      ...h,
      price_override: h.price_override ?? null,
      note: h.note ?? null,
      price: null,
      estimated_price: null,
    }));

  const tickers = [...new Set(tradeable.map((h) => h.ticker))];
  const oldestMs = Math.min(...tradeable.map((h) => new Date(h.recorded_at).getTime()));
  const days = Math.ceil((Date.now() - oldestMs) / 86_400_000) + 7;

  const closesByTicker = new Map<string, Array<{ date: string; close: number }>>();
  try {
    // getDailyPrices returns rows ordered by date asc.
    for (const row of await getDailyPrices(tickers, days)) {
      const list = closesByTicker.get(row.ticker) ?? [];
      list.push({ date: row.date, close: row.close_price });
      closesByTicker.set(row.ticker, list);
    }
  } catch (e) {
    console.warn('[holdings_history] daily price lookup failed:', e);
  }

  const missing = new Set<string>();
  const priced = history.map((h) => {
    const override = h.price_override ?? null;
    const note = h.note ?? null;
    if (h.is_static) return { ...h, price_override: override, note, price: null, estimated_price: null };
    const dateKey = ET_DATE_KEY.format(new Date(h.recorded_at));
    const closes = closesByTicker.get(h.ticker) ?? [];
    let estimate: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i].date <= dateKey) {
        estimate = closes[i].close;
        break;
      }
    }
    if (estimate == null) missing.add(h.ticker);
    return { ...h, price_override: override, note, price: override ?? estimate, estimated_price: estimate };
  });

  if (missing.size > 0) {
    try {
      const cached = await getCachedPrices([...missing]);
      for (const h of priced) {
        if (h.estimated_price == null && !h.is_static) {
          h.estimated_price = cached.get(h.ticker)?.current_price ?? null;
          if ((h.price_override ?? null) == null) h.price = h.estimated_price;
        }
      }
    } catch (e) {
      console.warn('[holdings_history] price_cache fallback failed:', e);
    }
  }
  return priced;
}
