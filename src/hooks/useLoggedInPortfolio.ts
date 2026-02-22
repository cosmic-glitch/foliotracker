import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'foliotracker_logged_in';

interface LoginState {
  portfolioId: string;
  token: string;
  timestamp: number;
  expiresAt: string;
}

// Legacy format detection (had password field, no token)
interface LegacyLoginState {
  portfolioId: string;
  password: string;
  timestamp: number;
}

function isLegacyState(state: unknown): state is LegacyLoginState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'password' in state &&
    !('token' in state)
  );
}

export function useLoggedInPortfolio() {
  const [loggedInAs, setLoggedInAs] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        // Clear legacy format — user will need to re-login
        if (isLegacyState(state)) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        // Check expiry
        if (new Date(state.expiresAt) < new Date()) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setLoggedInAs(state.portfolioId);
      }
    } catch {
      // Invalid stored data, clear it
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback((portfolioId: string, token: string, expiresAt: string) => {
    const state: LoginState = {
      portfolioId: portfolioId.toLowerCase(),
      token,
      timestamp: Date.now(),
      expiresAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setLoggedInAs(portfolioId.toLowerCase());
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLoggedInAs(null);
  }, []);

  const getToken = useCallback((): string | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        if (isLegacyState(state)) return null;
        // Check expiry
        if (new Date(state.expiresAt) < new Date()) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return state.token;
      }
    } catch {
      // Invalid stored data
    }
    return null;
  }, []);

  return {
    loggedInAs,
    login,
    logout,
    getToken,
  };
}
