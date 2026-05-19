-- Migration 010: Per-portfolio toggle for publishing allocation percentages.
--
-- When `allocation_public = TRUE` (default) and a portfolio's visibility is
-- `private` or `selective`, viewers who lack full-access permission still
-- receive a stripped allocation-only response (allocation %, day-change %,
-- ticker identities) instead of being blocked entirely. Owners can flip this
-- off in the Permissions modal to restore opaque-blur behavior.
--
-- Defaulting to TRUE backfills existing rows in the same statement; no
-- separate UPDATE pass is needed.

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS allocation_public BOOLEAN DEFAULT TRUE NOT NULL;

COMMENT ON COLUMN portfolios.allocation_public IS
  'When TRUE and visibility != public, restricted viewers see allocation percentages (no dollar amounts). Default TRUE.';
