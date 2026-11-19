import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, describeError } from '../api';
import { useAuth } from '../auth';

/**
 * Target of the link in the sign-in letter: /login/verify#token=… (ADR 0011).
 * The token is in the fragment, so it never reaches server logs or Referer, and it is spent
 * only by this page's POST — mail scanners that merely GET the link do not burn it.
 */
export function VerifyLinkPage(): ReactElement {
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in development; the token is single-use, so POST it once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Drop the token from the address bar and history right away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('У посиланні немає коду входу. Відкрийте посилання з листа ще раз.');
      return;
    }
    api
      .verifyLink(token)
      .then(async ({ user }) => {
        signedIn(user);
        await navigate('/licenses', { replace: true });
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [signedIn, navigate]);

  return (
    <section className="narrow">
      <h1>Вхід</h1>
      {error === null ? (
        <p className="muted">Перевіряємо посилання…</p>
      ) : (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <p>
            <Link to="/login">Отримати новий код</Link>
          </p>
        </>
      )}
    </section>
  );
}
