import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'unlocked_portfolios';

interface UnlockedEntry {
  token: string;
  timestamp: number;
  expiresAt: string;
}

export function useUnlockedPortfolios() {
  const [unlocked, setUnlocked] = useState<Record<string, UnlockedEntry>>({});

  // Load from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Clear any legacy entries that have password instead of token
        const cleaned: Record<string, UnlockedEntry> = {};
        for (const [key, value] of Object.entries(parsed)) {
          const entry = value as Record<string, unknown>;
          if (entry.token && typeof entry.token === 'string') {
            cleaned[key] = entry as unknown as UnlockedEntry;
          }
        }
        setUnlocked(cleaned);
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

  const unlock = useCallback((portfolioId: string, token: string, expiresAt: string) => {
    setUnlocked((prev) => ({
      ...prev,
      [portfolioId]: { token, timestamp: Date.now(), expiresAt },
    }));
  }, []);

  const lock = useCallback((portfolioId: string) => {
    setUnlocked((prev) => {
      const { [portfolioId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const getToken = useCallback(
    (portfolioId: string): string | null => {
      const entry = unlocked[portfolioId];
      if (!entry) return null;
      // Check expiry
      if (new Date(entry.expiresAt) < new Date()) return null;
      return entry.token;
    },
    [unlocked]
  );

  const isUnlocked = useCallback(
    (portfolioId: string): boolean => {
      return portfolioId in unlocked;
    },
    [unlocked]
  );

  return { unlock, lock, getToken, isUnlocked };
}
