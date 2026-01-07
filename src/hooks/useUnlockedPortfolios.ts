import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'unlocked_portfolios';

interface UnlockedEntry {
  password: string;
  timestamp: number;
}

export function useUnlockedPortfolios() {
  const [unlocked, setUnlocked] = useState<Record<string, UnlockedEntry>>({});

  // Load from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setUnlocked(JSON.parse(stored));
      } catch {
        // Invalid JSON, clear it
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  // Save to sessionStorage on change
  useEffect(() => {
    if (Object.keys(unlocked).length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(unlocked));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [unlocked]);

  const unlock = useCallback((portfolioId: string, password: string) => {
    setUnlocked((prev) => ({
      ...prev,
      [portfolioId]: { password, timestamp: Date.now() },
    }));
  }, []);

  const lock = useCallback((portfolioId: string) => {
    setUnlocked((prev) => {
      const { [portfolioId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const getPassword = useCallback(
    (portfolioId: string): string | null => {
      return unlocked[portfolioId]?.password ?? null;
    },
    [unlocked]
  );

  const isUnlocked = useCallback(
    (portfolioId: string): boolean => {
      return portfolioId in unlocked;
    },
    [unlocked]
  );

  return { unlock, lock, getPassword, isUnlocked };
}
