import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AuthForm } from './AuthForm';

export function RegisterPage(): ReactElement {
  const { login } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthForm
      title="Реєстрація"
      submitLabel="Створити акаунт"
      passwordAutocomplete="new-password"
      onSubmit={async (email, password) => {
        await api.register(email, password);
        await login(email, password);
        await navigate('/');
      }}
      footer={
        <>
          Уже є акаунт? <Link to="/login">Увійти</Link>
        </>
      }
    />
  );
}
