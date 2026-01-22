import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'foliotracker_logged_in';

interface LoginState {
  portfolioId: string;
  password: string;
  timestamp: number;
}

export function useLoggedInPortfolio() {
  const [loggedInAs, setLoggedInAs] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: LoginState = JSON.parse(stored);
        setLoggedInAs(state.portfolioId);
      }
    } catch {
      // Invalid stored data, clear it
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback((portfolioId: string, password: string) => {
    const state: LoginState = {
      portfolioId: portfolioId.toLowerCase(),
      password,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setLoggedInAs(portfolioId.toLowerCase());
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLoggedInAs(null);
  }, []);

  const getPassword = useCallback((): string | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: LoginState = JSON.parse(stored);
        return state.password;
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
    getPassword,
  };
}
