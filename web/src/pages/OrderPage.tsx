import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useAuthed } from './useAuthed';

export function OrderPage(): ReactElement {
  const { id = '' } = useParams();
  const { t, formatDate, formatPrice } = useI18n();
  const { data: order, error, reload } = useAuthed(() => api.order(id), [id]);

  return (
    <section className="narrow">
      <h1>{t.order.title}</h1>
      {error && <p className="error">{error}</p>}
      {order === null && !error && <p className="muted">{t.loading}</p>}
      {order && (
        <div className="card">
          <p>
            {t.order.summary} <strong>{t.plans.names[order.planId] ?? order.planId}</strong> ·{' '}
            {formatPrice(order.amountCents)} · {t.order.created} {formatDate(order.createdAt)}
          </p>
          {order.status === 'PENDING' && (
            <>
              <p>
                <span className="badge unactivated">{t.order.pending}</span>
              </p>
              <p className="muted">{t.order.pendingNote}</p>
              <button type="button" className="button secondary" onClick={reload}>
                {t.order.refresh}
              </button>
            </>
          )}
          {order.status === 'PAID' && (
            <>
              <p>
                <span className="badge active">{t.order.paid}</span> {formatDate(order.paidAt)}
              </p>
              <p>
                {t.order.yourKey} <code className="key">{order.licenseKey}</code>
              </p>
              <Link to="/licenses">{t.order.toLicenses}</Link>
            </>
          )}
          {order.status === 'FAILED' && (
            <p>
              <span className="badge banned">{t.order.failed}</span> —{' '}
              <Link to="/">{t.order.retry}</Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
