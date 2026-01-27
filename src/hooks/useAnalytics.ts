import { useCallback, useEffect, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export function useViewAnalytics(
  portfolioId: string | undefined,
  password: string | null,
  loggedInAs: string | null
) {
  const hasLoggedInitial = useRef(false);
  const currentPortfolioId = useRef(portfolioId);

  // Store current values in refs so the callback always has the latest values
  const passwordRef = useRef(password);
  const loggedInAsRef = useRef(loggedInAs);

  // Keep refs updated
  useEffect(() => {
    passwordRef.current = password;
    loggedInAsRef.current = loggedInAs;
  }, [password, loggedInAs]);

  // Stable logView function that uses refs for password/loggedInAs
  const logView = useCallback(async () => {
    if (!portfolioId) return;

    try {
      await fetch(`${API_BASE_URL}/api/log-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          password: passwordRef.current || undefined,
          logged_in_as: loggedInAsRef.current || undefined,
        }),
      });
    } catch (err) {
      // Fire and forget - don't break the app
      console.error('Failed to log view:', err);
    }
  }, [portfolioId]);

  // Reset flag when portfolioId changes
  useEffect(() => {
    if (portfolioId !== currentPortfolioId.current) {
      hasLoggedInitial.current = false;
      currentPortfolioId.current = portfolioId;
    }
  }, [portfolioId]);

  // Log on initial mount (once per portfolioId)
  useEffect(() => {
    if (portfolioId && !hasLoggedInitial.current) {
      hasLoggedInitial.current = true;
      logView();
    }
  }, [portfolioId, logView]);

  // Log when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && portfolioId) {
        logView();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [portfolioId, logView]);

  // Return logView for manual refresh button
  return { logView };
}
