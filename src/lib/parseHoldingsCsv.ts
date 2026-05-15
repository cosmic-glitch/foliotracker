import type { TradeableHoldingInput } from '../types/portfolio';

export interface ParseHoldingsCsvResult {
  holdings: TradeableHoldingInput[];
  errors: string[]; // human-readable, one per rejected line
}

// Strip a single matching leading/trailing double-quote pair. Not full
// RFC-4180 escaping — the 2-3 column numeric format has no embedded commas.
function unwrapQuotes(cell: string): string {
  if (cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')) {
    return cell.slice(1, -1).trim();
  }
  return cell;
}

/**
 * Parse a CSV of tradable holdings in the same 2-or-3 column shape as a manual
 * form row: ticker, shares, optional cost/share. A header row is auto-detected
 * and skipped. Never throws — malformed rows are collected into `errors`.
 */
export function parseHoldingsCsv(text: string): ParseHoldingsCsvResult {
  const holdings: TradeableHoldingInput[] = [];
  const errors: string[] = [];

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let headerChecked = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i];
    if (raw.trim() === '') continue;

    const cells = raw.split(',').map((c) => unwrapQuotes(c.trim()));

    // Header auto-detect: on the first non-blank line, if the shares cell is
    // empty or non-numeric, treat the whole line as a header and skip it.
    if (!headerChecked) {
      headerChecked = true;
      const sharesCell = cells[1] ?? '';
      if (sharesCell === '' || Number.isNaN(Number(sharesCell))) {
        continue;
      }
    }

    const ticker = (cells[0] ?? '').toUpperCase();
    if (ticker === '') {
      errors.push(`Line ${lineNumber}: missing ticker`);
      continue;
    }

    const sharesRaw = cells[1] ?? '';
    const shares = Number(sharesRaw);
    if (!Number.isFinite(shares) || shares <= 0) {
      errors.push(`Line ${lineNumber}: invalid shares value "${sharesRaw}"`);
      continue;
    }

    const costRaw = cells[2] ?? '';
    const costNum = Number(costRaw);
    // Cost/share is optional — a blank or garbage cell is not an error.
    const costBasisPerShare =
      costRaw !== '' && Number.isFinite(costNum) && costNum > 0 ? costNum : undefined;

    const holding: TradeableHoldingInput = { ticker, shares };
    if (costBasisPerShare !== undefined) {
      holding.costBasisPerShare = costBasisPerShare;
    }
    holdings.push(holding);
  }

  return { holdings, errors };
}
