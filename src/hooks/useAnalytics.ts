import { useCallback, useEffect, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export function useViewAnalytics(
  portfolioId: string | undefined,
  token: string | null,
  loggedInAs: string | null,
  shareToken: string | null
) {
  const hasLoggedInitial = useRef(false);
  const currentPortfolioId = useRef(portfolioId);

  // Store current values in refs so the callback always has the latest values
  const tokenRef = useRef(token);
  const loggedInAsRef = useRef(loggedInAs);
  const shareTokenRef = useRef(shareToken);

  // Keep refs updated
  useEffect(() => {
    tokenRef.current = token;
    loggedInAsRef.current = loggedInAs;
    shareTokenRef.current = shareToken;
  }, [token, loggedInAs, shareToken]);

  // Stable logView function that uses refs for token/loggedInAs/shareToken
  const logView = useCallback(async () => {
    if (!portfolioId) return;

    try {
      await fetch(`${API_BASE_URL}/api/log-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          token: tokenRef.current || undefined,
          logged_in_as: loggedInAsRef.current || undefined,
          // Attribute the view to the share link the visitor arrived through, so
          // the Analytics Dashboard's Shared Link Access panel can count it.
          share_token: shareTokenRef.current || undefined,
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

// Logs landing-page views (no portfolio_id). Same trigger pattern as
// useViewAnalytics: once on mount, then on every visibilitychange→visible.
export function useLandingViewAnalytics(loggedInAs: string | null) {
  const hasLoggedInitial = useRef(false);
  const loggedInAsRef = useRef(loggedInAs);

  useEffect(() => {
    loggedInAsRef.current = loggedInAs;
  }, [loggedInAs]);

  const logView = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/log-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logged_in_as: loggedInAsRef.current || undefined,
        }),
      });
    } catch (err) {
      console.error('Failed to log landing view:', err);
    }
  }, []);

  useEffect(() => {
    if (!hasLoggedInitial.current) {
      hasLoggedInitial.current = true;
      logView();
    }
  }, [logView]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        logView();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [logView]);
}
