import type { ReactElement } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from './auth';

export function Layout(): ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async (): Promise<void> => {
    await logout();
    await navigate('/');
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          License &amp; Config Hub
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Тарифи
          </NavLink>
          {user && <NavLink to="/licenses">Мої ліцензії</NavLink>}
          {user ? (
            <>
              <span className="muted" title={user.role}>
                {user.email}
              </span>
              <button type="button" className="link" onClick={() => void onLogout()}>
                Вийти
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Вхід</NavLink>
              <NavLink to="/register" className="button small">
                Реєстрація
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer muted">License &amp; Config Hub · Node.js course project</footer>
    </div>
  );
}
