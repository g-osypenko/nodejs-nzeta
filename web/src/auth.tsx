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
 * Session state. The session itself is an httpOnly cookie (ADR 0011): page scripts cannot read
 * it, so an XSS cannot steal it. The page only knows *who* is signed in, asked from GET auth/me.
 */
interface AuthState {
  user: User | null;
  /** True until the first auth/me answer: pages must not redirect to /login before it. */
  loading: boolean;
  /** Called after a successful code or link verification (the cookie is already set). */
  signedIn: (user: User) => void;
  logout: () => Promise<void>;
  /** Drops a session the server no longer accepts (401) without calling the API. */
  forget: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const forget = useCallback((): void => setUser(null), []);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((error: unknown) => {
        // 401 = no session; anything else (offline, 5xx) also leaves the visitor signed out.
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const signedIn = useCallback((me: User): void => {
    setUser(me);
    setLoading(false);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    forget();
  }, [forget]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signedIn, logout, forget }),
    [user, loading, signedIn, logout, forget],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
