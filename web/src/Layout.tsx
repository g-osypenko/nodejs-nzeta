import type { ReactElement } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import wordmark from './assets/nzeta-wordmark.svg';
import { useAuth } from './auth';
import { LANGS, useI18n } from './i18n';

function GlobeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="icon">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** EN / UK: both visible, the current one highlighted — one click, no menu to open. */
function LanguageSwitch(): ReactElement {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.langLabel}>
      <GlobeIcon />
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={l === lang ? 'lang-option current' : 'lang-option'}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {l === 'uk' ? 'UK' : 'EN'}
        </button>
      ))}
    </div>
  );
}

export function Layout(): ReactElement {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const onLogout = async (): Promise<void> => {
    await navigate('/');
    await logout();
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="nzeta">
          <img src={wordmark} alt="nzeta" width="63" height="36" />
        </Link>
        <nav className="nav">
          <LanguageSwitch />
          <NavLink to="/" end>
            {t.nav.plans}
          </NavLink>
          {user && <NavLink to="/licenses">{t.nav.licenses}</NavLink>}
          {user ? (
            <>
              <span className="muted user" title={user.role}>
                {user.email}
              </span>
              <button type="button" className="link" onClick={() => void onLogout()}>
                {t.nav.signOut}
              </button>
            </>
          ) : (
            <NavLink to="/login" className="button small">
              {t.nav.signIn}
            </NavLink>
          )}
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
