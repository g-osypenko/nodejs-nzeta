import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { api, formatDate, formatPrice } from '../api';
import { useAuthed } from './useAuthed';

export function OrderPage(): ReactElement {
  const { id = '' } = useParams();
  const { data: order, error, reload } = useAuthed((token) => api.order(token, id), [id]);

  return (
    <section className="narrow">
      <h1>Замовлення</h1>
      {error && <p className="error">{error}</p>}
      {order === null && !error && <p className="muted">Завантаження…</p>}
      {order && (
        <div className="card">
          <p>
            Тариф <strong>{order.planId}</strong> · {formatPrice(order.amountCents)} · створено{' '}
            {formatDate(order.createdAt)}
          </p>
          {order.status === 'PENDING' && (
            <>
              <p>
                <span className="badge unactivated">очікує оплати</span>
              </p>
              <p className="muted">
                Оплату підтверджує платіжний провайдер вебхуком. Справжнього провайдера ще не
                підключено (spec.md §7), тож на стейджі замовлення лишається в цьому стані.
              </p>
              <button type="button" className="button secondary" onClick={reload}>
                Оновити стан
              </button>
            </>
          )}
          {order.status === 'PAID' && (
            <>
              <p>
                <span className="badge active">оплачено</span> {formatDate(order.paidAt)}
              </p>
              <p>
                Ваш ключ: <code className="key">{order.licenseKey}</code>
              </p>
              <Link to="/licenses">До моїх ліцензій →</Link>
            </>
          )}
          {order.status === 'FAILED' && (
            <p>
              <span className="badge banned">оплата не пройшла</span> —{' '}
              <Link to="/">спробувати ще раз</Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
