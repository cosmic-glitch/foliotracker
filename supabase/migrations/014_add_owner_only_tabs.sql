-- Per-portfolio "show only to me" switches for the CG (capital gains) and
-- Changes tabs, set from the Permissions modal. When on, every viewer other
-- than the owner (or admin) loses the tab even if they can see dollar
-- values: /api/portfolio strips cost basis / gains, /api/holdings-history 403s.
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS gains_owner_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS changes_owner_only BOOLEAN NOT NULL DEFAULT FALSE;
