import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { api, ApiError, type User } from './api';

/**
 * Session state. The opaque Bearer token is kept in localStorage — a deliberate shortcut of the
 * skeleton: readable by any script on the page (XSS). Moving to an httpOnly cookie is an open
 * product decision (docs/product/web.md); same origin (ADR 0008) keeps that move cheap.
 */
const STORAGE_KEY = 'lch.session';

interface StoredSession {
  token: string;
  expiresAt: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Drops a session the server no longer accepts (401) without calling the API. */
  forget: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, expiresAt } = parsed as Partial<StoredSession>;
    if (typeof token !== 'string' || typeof expiresAt !== 'string') return null;
    return Date.parse(expiresAt) > Date.now() ? { token, expiresAt } : null;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null): void {
  try {
    if (session === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode): the session lives only in memory for this tab.
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [token, setToken] = useState<string | null>(() => readStored()?.token ?? null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(token !== null);

  const forget = useCallback((): void => {
    writeStored(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (token === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .me(token)
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof ApiError && error.status === 401) forget();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [token, forget]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const session = await api.login(email, password);
    writeStored(session);
    setLoading(true);
    setToken(session.token);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (token !== null) await api.logout(token).catch(() => undefined);
    forget();
  }, [token, forget]);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, logout, forget }),
    [user, token, loading, login, logout, forget],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
