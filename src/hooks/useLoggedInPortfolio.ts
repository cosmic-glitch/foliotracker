import { useState, useCallback, useEffect } from 'react';
import { renewSessionToken } from '../lib/auth';

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

// Synchronously read localStorage so first render already reflects login state.
// Without this, consumers (analytics, data fetching) briefly see a logged-out
// app on boot and fire events/requests without identity.
function readInitialLoggedInAs(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const state = JSON.parse(stored);
    if (isLegacyState(state)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (new Date(state.expiresAt) < new Date()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return state.portfolioId;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

// Sessions slide (server: renewSession in api/_lib/db.ts). Renew once per page
// load when the stored session is over a day old, so a 30-day expiry only bites
// after 30 days of inactivity. A 401 means the session was revoked server-side
// (password change) — log out instead of showing a logged-in state whose token
// every request rejects.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const LOGOUT_EVENT = 'foliotracker:logged-out';
let renewalAttempted = false;

function readState(): LoginState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const state = JSON.parse(stored);
    return isLegacyState(state) || !state.token ? null : state;
  } catch {
    return null;
  }
}

async function renewIfStale(): Promise<void> {
  const state = readState();
  if (!state) return;
  const remaining = new Date(state.expiresAt).getTime() - Date.now();
  if (remaining <= 0 || remaining > SESSION_TTL_MS - RENEW_AFTER_MS) return;

  const result = await renewSessionToken(state.token);
  if (result === null) return;
  // The user may have logged out or in as someone else while this was in flight.
  if (readState()?.token !== state.token) return;
  if (result === 'invalid') {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(LOGOUT_EVENT));
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, expiresAt: result }));
  }
}

export function useLoggedInPortfolio() {
  const [loggedInAs, setLoggedInAs] = useState<string | null>(readInitialLoggedInAs);

  // The hook is mounted by many components; the module flag keeps it to one
  // renewal per page load, and the event logs every instance out together.
  useEffect(() => {
    const onLoggedOut = () => setLoggedInAs(null);
    window.addEventListener(LOGOUT_EVENT, onLoggedOut);
    if (!renewalAttempted && loggedInAs) {
      renewalAttempted = true;
      void renewIfStale();
    }
    return () => window.removeEventListener(LOGOUT_EVENT, onLoggedOut);
  }, [loggedInAs]);

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
