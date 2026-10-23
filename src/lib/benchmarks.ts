// Viewer's pick of funds the 1D/30D charts overlay by % move (picked in the
// Customize sheet, persisted per browser). Stored as fixed slots rather than a
// list so each fund keeps its color when another is removed — color follows
// the fund, never its position among the survivors. Empty slots are null.

export const MAX_BENCHMARKS = 3;

// One color per slot. Validated (dataviz validate_palette.js, all pairs)
// against both card surfaces (#1e293b dark, #fff light) alongside the
// portfolio's #3b82f6; amber/magenta/teal keep clear of the gain/loss
// green/red. Teal↔magenta sits in the deutan 6–8 ΔE floor band, which is
// legal because every line is direct-labeled (line-end labels + tooltip).
export const BENCHMARK_COLORS = ['#c98500', '#d55181', '#0e9aa7'];

export type BenchmarkSlots = (string | null)[];

export const DEFAULT_BENCHMARKS: BenchmarkSlots = ['VOO', 'QQQ', null];

// Matches api/ticker.ts's symbol check.
export const BENCHMARK_SYMBOL_RE = /^[A-Z0-9.\-^=]{1,20}$/;
