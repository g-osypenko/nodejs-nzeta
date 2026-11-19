import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AuthProvider } from './auth';
import { I18nProvider } from './i18n';
import { Layout } from './Layout';
import { AccountPage } from './pages/AccountPage';
import { GuidesPage } from './pages/GuidesPage';
import { LicensesPage } from './pages/LicensesPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { PlansPage } from './pages/PlansPage';
import { VerifyLinkPage } from './pages/VerifyLinkPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <PlansPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'login/verify', element: <VerifyLinkPage /> },
      // Sign-up is the first sign-in by code (ADR 0011); old links keep working.
      { path: 'register', element: <Navigate to="/login" replace /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'guides', element: <GuidesPage /> },
      { path: 'guides/:slug', element: <GuidesPage /> },
      { path: 'licenses', element: <LicensesPage /> },
      { path: 'orders/:id', element: <OrderPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing in index.html');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
