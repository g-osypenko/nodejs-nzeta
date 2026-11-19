import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError, describeError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

/** Only same-site paths are accepted as ?next= (no open redirect to another origin). */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

/** Matches the server's resend cooldown (ADR 0011); the server stays the authority (429). */
const RESEND_AFTER_S = 60;

/**
 * Passwordless sign-in (ADR 0011): step 1 — email, step 2 — the 6-digit code from the letter.
 * The letter also has a one-click link (VerifyLinkPage). There is no separate registration:
 * the first sign-in creates the account.
 */
export function LoginPage(): ReactElement {
  const { signedIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await api.requestCode(email.trim());
      setStep('code');
      setCode('');
      setResendIn(RESEND_AFTER_S);
    } catch (e) {
      setFailure(e);
      if (e instanceof ApiError && e.code === 'TOO_MANY_REQUESTS') setStep('code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const { user } = await api.verifyCode(email.trim(), code);
      signedIn(user);
      await navigate(safeNext(params.get('next')));
    } catch (e) {
      setFailure(e);
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void (step === 'email' ? sendCode() : verify());
  };

  const error = failure === null ? null : describeError(failure, t.errors);

  return (
    <section className="narrow">
      <h1>{t.login.title}</h1>
      <form className="form" onSubmit={submit}>
        <label>
          {t.login.email}
          <input
            type="email"
            autoComplete="email"
            required
            readOnly={step === 'code'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {step === 'code' && (
          <>
            <p className="muted">{t.login.sent(email.trim())}</p>
            {import.meta.env.DEV && <p className="muted dev-note">{t.account.testCode}</p>}
            <label>
              {t.login.code}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 \-]{6,9}"
                maxLength={9}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d-]/g, ''))}
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? t.login.wait : step === 'email' ? t.login.send : t.login.submit}
        </button>
      </form>
      {step === 'code' && (
        <p className="muted">
          <button
            type="button"
            className="link"
            disabled={busy || resendIn > 0}
            onClick={() => void sendCode()}
          >
            {resendIn > 0 ? t.login.resendIn(resendIn) : t.login.resend}
          </button>
          {' · '}
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => {
              setStep('email');
              setFailure(null);
            }}
          >
            {t.login.otherEmail}
          </button>
        </p>
      )}
      {step === 'email' && <p className="muted">{t.login.noPassword}</p>}
    </section>
  );
}
