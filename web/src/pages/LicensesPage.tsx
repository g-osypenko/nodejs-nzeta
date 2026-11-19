import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useAuthed } from './useAuthed';

export function LicensesPage(): ReactElement {
  const { t, formatDate } = useI18n();
  const { data: licenses, error } = useAuthed(() => api.licenses());

  return (
    <section>
      <h1>{t.licenses.title}</h1>
      {error && <p className="error">{error}</p>}
      {licenses === null && !error && <p className="muted">{t.loading}</p>}
      {licenses?.length === 0 && (
        <p>
          {t.licenses.empty} <Link to="/">{t.licenses.choosePlan}</Link>.
        </p>
      )}
      {licenses && licenses.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.licenses.key}</th>
                <th>{t.licenses.state}</th>
                <th>{t.licenses.device}</th>
                <th>{t.licenses.activated}</th>
                <th>{t.licenses.validUntil}</th>
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l.id}>
                  <td>
                    <code>{l.key}</code>
                  </td>
                  <td>
                    <span className={`badge ${l.status.toLowerCase()}`}>
                      {t.licenses.status[l.status]}
                    </span>
                  </td>
                  <td>{l.hwid ?? '—'}</td>
                  <td>{formatDate(l.activatedAt)}</td>
                  <td>
                    {l.expiresAt
                      ? formatDate(l.expiresAt)
                      : t.licenses.afterActivation(l.durationDays)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
