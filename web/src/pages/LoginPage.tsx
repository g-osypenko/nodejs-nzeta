import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError, describeError } from '../api';
import { useAuth } from '../auth';

/** Only same-site paths are accepted as ?next= (no open redirect to another origin). */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/licenses';
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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(email.trim());
      setStep('code');
      setCode('');
      setResendIn(RESEND_AFTER_S);
    } catch (e) {
      setError(describeError(e));
      if (e instanceof ApiError && e.code === 'TOO_MANY_REQUESTS') setStep('code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.verifyCode(email.trim(), code);
      signedIn(user);
      await navigate(safeNext(params.get('next')));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void (step === 'email' ? sendCode() : verify());
  };

  return (
    <section className="narrow">
      <h1>Вхід</h1>
      <form className="form" onSubmit={submit}>
        <label>
          Email
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
            <p className="muted">
              Ми надіслали на {email.trim()} лист із кодом і посиланням для входу. Код діє 10
              хвилин.
            </p>
            <label>
              Код із листа
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
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
          {busy ? 'Зачекайте…' : step === 'email' ? 'Надіслати код' : 'Увійти'}
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
            {resendIn > 0 ? `Надіслати код ще раз через ${resendIn} с` : 'Надіслати код ще раз'}
          </button>
          {' · '}
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => {
              setStep('email');
              setError(null);
            }}
          >
            Інший email
          </button>
        </p>
      )}
      {step === 'email' && (
        <p className="muted">Пароль не потрібен. Якщо акаунта ще немає, ми його створимо.</p>
      )}
    </section>
  );
}
