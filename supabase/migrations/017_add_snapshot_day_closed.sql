-- Lines sold out today, still counted in the trade-aware day change
-- (api/_lib/day-flows.ts): each one's move from the previous close up to the
-- sale and its share of the day-change % denominator. Rewritten every refresh;
-- an empty array outside days with a sell-out.
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS day_closed_json JSONB;
