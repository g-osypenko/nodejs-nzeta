import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { describeError } from '../api';

interface Props {
  title: string;
  submitLabel: string;
  passwordAutocomplete: 'current-password' | 'new-password';
  onSubmit: (email: string, password: string) => Promise<void>;
  footer: ReactNode;
}

/** Shared email/password form of the login and registration pages. */
export function AuthForm({
  title,
  submitLabel,
  passwordAutocomplete,
  onSubmit,
  footer,
}: Props): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email.trim(), password);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <section className="narrow">
      <h1>{title}</h1>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete={passwordAutocomplete}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Зачекайте…' : submitLabel}
        </button>
      </form>
      <p className="muted">{footer}</p>
    </section>
  );
}
