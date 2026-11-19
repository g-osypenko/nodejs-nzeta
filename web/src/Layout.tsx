import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import banner from './assets/nzeta-banner.gif';
import { useAuth } from './auth';
import { LANGS, useI18n, type Lang } from './i18n';
import { DISCORD_INVITE } from './links';

const LANG_NAMES: Record<Lang, string> = { uk: 'Українська', en: 'English' };

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

function DiscordIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="icon">
      <path
        fill="currentColor"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
      />
    </svg>
  );
}

/** Dropdown: globe + current language; closes on choice, outside click and Escape. */
function LanguageMenu(): ReactElement {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lang" ref={root}>
      <button
        type="button"
        className="lang-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.langLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <GlobeIcon />
        <span>{lang.toUpperCase()}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox" aria-label={t.langLabel}>
          {LANGS.map((l) => (
            <li key={l} role="option" aria-selected={l === lang}>
              <button
                type="button"
                className={l === lang ? 'current' : undefined}
                onClick={() => {
                  setLang(l);
                  setOpen(false);
                }}
              >
                {LANG_NAMES[l]}
              </button>
            </li>
          ))}
        </ul>
      )}
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
        <Link to="/" className="brand" aria-label="Neural Zeta">
          <img src={banner} alt="Neural Zeta" width="417" height="112" />
        </Link>
        <nav className="nav">
          <NavLink to="/guides">{t.nav.guides}</NavLink>
          <NavLink to="/" end>
            {t.nav.plans}
          </NavLink>
          {user && <NavLink to="/account">{t.nav.account}</NavLink>}
          <LanguageMenu />
          <a
            href={DISCORD_INVITE}
            className="icon-link"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord"
            title="Discord"
          >
            <DiscordIcon />
          </a>
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
      <footer className="footer">
        <p className="muted">{t.supportNote}</p>
        <a
          href={DISCORD_INVITE}
          className="button secondary support"
          target="_blank"
          rel="noopener noreferrer"
        >
          <DiscordIcon />
          {t.support}
        </a>
      </footer>
    </div>
  );
}
