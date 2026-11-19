import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { api, formatDate, type License } from '../api';
import { useAuthed } from './useAuthed';

const STATUS_LABEL: Record<License['status'], string> = {
  UNACTIVATED: 'не активована',
  ACTIVE: 'активна',
  EXPIRED: 'прострочена',
  BANNED: 'заблокована',
};

export function LicensesPage(): ReactElement {
  const { data: licenses, error } = useAuthed((token) => api.licenses(token));

  return (
    <section>
      <h1>Мої ліцензії</h1>
      {error && <p className="error">{error}</p>}
      {licenses === null && !error && <p className="muted">Завантаження…</p>}
      {licenses?.length === 0 && (
        <p>
          Ліцензій ще немає — <Link to="/">оберіть тариф</Link>.
        </p>
      )}
      {licenses && licenses.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ключ</th>
                <th>Стан</th>
                <th>Пристрій (HWID)</th>
                <th>Активовано</th>
                <th>Діє до</th>
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
                      {STATUS_LABEL[l.status]}
                    </span>
                  </td>
                  <td>{l.hwid ?? '—'}</td>
                  <td>{formatDate(l.activatedAt)}</td>
                  <td>
                    {l.expiresAt ? formatDate(l.expiresAt) : `${l.durationDays} дн. від активації`}
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
