-- Editable change-log entries: a user-corrected per-share price (tradeable
-- rows only; NULL means "use the EOD-close estimate") and a free-text
-- annotation (e.g. ESPP, RSU vest). Both owner-edited via PATCH
-- /api/holdings-history; reads prefer price_override over the estimate.
-- Not applied in dev-complete mode; the API degrades (edits 409) when missing.
ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS price_override DECIMAL(14,4);
ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS note VARCHAR(60);
