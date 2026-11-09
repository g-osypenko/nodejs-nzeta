import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, describeError } from '../api';
import { useAuth } from '../auth';

interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

/**
 * Loads data that needs a session. No session → login page with ?next= back here;
 * 401 from the server (expired/revoked) → the stale session is dropped, same redirect.
 */
export function useAuthed<T>(load: (token: string) => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const { token, loading, forget } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading) return;
    const toLogin = (): void => {
      void navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    };
    if (token === null) {
      toLogin();
      return;
    }
    let cancelled = false;
    load(token)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          forget();
          toLogin();
        } else {
          setError(describeError(e));
        }
      });
    return (): void => {
      cancelled = true;
    };
    // `load` is recreated on every render by callers; `deps` carries what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, attempt, ...deps]);

  return { data, error, reload: () => setAttempt((n) => n + 1) };
}
