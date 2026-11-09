import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { api, describeError, formatPrice, type Plan } from '../api';
import { useAuth } from '../auth';

export function PlansPage(): ReactElement {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    api
      .plans()
      .then(setPlans)
      .catch((e: unknown) => setError(describeError(e)));
  }, []);

  const buy = async (planId: string): Promise<void> => {
    if (token === null) {
      await navigate(`/login?next=${encodeURIComponent('/')}`);
      return;
    }
    setBuying(planId);
    setError(null);
    try {
      // One key per click: a retried request (double click, flaky network) returns the same order.
      const order = await api.createOrder(token, planId, crypto.randomUUID());
      await navigate(`/orders/${order.id}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBuying(null);
    }
  };

  return (
    <section>
      <h1>Тарифи</h1>
      <p className="lead">
        Ліцензія прив’язується до пристрою (HWID) під час першого запуску. Строк іде від активації,
        а не від покупки.
      </p>
      {error && <p className="error">{error}</p>}
      {plans === null && !error && <p className="muted">Завантаження…</p>}
      <div className="grid">
        {plans?.map((plan) => (
          <article key={plan.id} className="card">
            <h2>{plan.name}</h2>
            <p className="price">{formatPrice(plan.priceCents)}</p>
            <p className="muted">{plan.durationDays} днів після активації</p>
            <button
              type="button"
              className="button"
              disabled={buying !== null}
              onClick={() => void buy(plan.id)}
            >
              {buying === plan.id ? 'Створюємо замовлення…' : 'Купити'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
