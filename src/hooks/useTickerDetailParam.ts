import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// The open ticker-detail panel lives in the URL (`?t=TICKER`) rather than
// local state so the browser back button (and the swipe-back gesture on
// mobile) closes it, and a link to a specific ticker is shareable. Opening
// pushes a history entry; closing via the X replaces it so Back from the
// closed page doesn't re-open the panel. Other params (`share`) are preserved.
// Shared by every surface that opens TickerDetailModal (holdings table,
// landing-page movers strip).
export function useTickerDetailParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openTicker = searchParams.get('t');

  const openDetail = useCallback(
    (ticker: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('t', ticker);
        return next;
      });
    },
    [setSearchParams],
  );

  const closeDetail = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('t');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return { openTicker, openDetail, closeDetail };
}
