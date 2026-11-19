import type { ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { AuthForm } from './AuthForm';

/** Only same-site paths are accepted as ?next= (no open redirect to another origin). */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/licenses';
}

export function LoginPage(): ReactElement {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return (
    <AuthForm
      title="Вхід"
      submitLabel="Увійти"
      passwordAutocomplete="current-password"
      onSubmit={async (email, password) => {
        await login(email, password);
        await navigate(safeNext(params.get('next')));
      }}
      footer={
        <>
          Немає акаунта? <Link to="/register">Зареєструватися</Link>
        </>
      }
    />
  );
}
