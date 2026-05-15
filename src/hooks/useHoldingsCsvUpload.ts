import { useState } from 'react';
import type { TradeableHoldingInput } from '../types/portfolio';
import { parseHoldingsCsv } from '../lib/parseHoldingsCsv';

/**
 * Shared file-read + merge + error plumbing for CSV bulk-upload of tradable
 * holdings. Used by both the Create and Edit portfolio forms, which keep
 * identical `TradeableHoldingInput[]` state.
 */
export function useHoldingsCsvUpload(
  tradeableHoldings: TradeableHoldingInput[],
  setTradeableHoldings: React.Dispatch<React.SetStateAction<TradeableHoldingInput[]>>,
): { csvError: string | null; handleCsvFile: (file: File) => Promise<void> } {
  const [csvError, setCsvError] = useState<string | null>(null);

  const handleCsvFile = async (file: File): Promise<void> => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setCsvError('Could not read the file');
      return;
    }

    const { holdings, errors } = parseHoldingsCsv(text);

    // Drop blank starter rows, keep manually-entered rows, append uploaded ones.
    const existing = tradeableHoldings.filter(
      (h) => h.ticker.trim() !== '' || h.shares > 0,
    );
    const next = [...existing, ...holdings];
    // Keep the form's one required starter row (delete-button length<=1 guard).
    setTradeableHoldings(next.length > 0 ? next : [{ ticker: '', shares: 0 }]);

    if (errors.length > 0) {
      const added = `Added ${holdings.length} holding${holdings.length === 1 ? '' : 's'}.`;
      const skipped = `Skipped ${errors.length} row${errors.length === 1 ? '' : 's'}:`;
      setCsvError(`${added} ${skipped}\n${errors.join('\n')}`);
    } else if (holdings.length === 0) {
      setCsvError('No holdings found in file');
    } else {
      setCsvError(null);
    }
  };

  return { csvError, handleCsvFile };
}
