-- Prior value of a static holding on 'updated'/'removed' rows, so the Changes
-- tab can show the dollar delta of a value edit (same as share deltas do).
-- NULL on 'added' rows and on rows logged before this column existed — the
-- client derives those from the ticker's earlier history rows.
ALTER TABLE holdings_history ADD COLUMN IF NOT EXISTS prev_static_value DECIMAL(14,2);
