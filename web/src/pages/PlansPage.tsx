import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { api, describeError, type Plan } from '../api';
import icon from '../assets/nzeta-icon.svg';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { SHOWCASE } from '../media';
import { useReveal } from '../reveal';

/**
 * Media frame between the hero and the plans. While you scroll past it, the frame grows from a
 * card to full width (CSS scroll-driven animation; a static frame where unsupported). Until the
 * video is shot (web/src/media.ts), a quiet placeholder with the breathing zeta stands in.
 */
function Showcase(): ReactElement {
  const { t } = useI18n();
  return (
    <section className="showcase" aria-label={t.showcase.soon}>
      <div className="showcase-frame">
        {SHOWCASE.video ? (
          <video
            src={SHOWCASE.video}
            {...(SHOWCASE.poster ? { poster: SHOWCASE.poster } : {})}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <div className="showcase-placeholder">
            <img src={icon} alt="" className="zeta-breath" width="160" height="160" />
            <p className="muted">{t.showcase.soon}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function PlansPage(): ReactElement {
  const { user } = useAuth();
  const { t, formatPrice } = useI18n();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const reveal = useReveal();

  useEffect(() => {
    api.plans().then(setPlans).catch(setFailure);
  }, []);

  const buy = async (planId: string): Promise<void> => {
    if (user === null) {
      await navigate(`/login?next=${encodeURIComponent('/')}`);
      return;
    }
    setBuying(planId);
    setFailure(null);
    try {
      // One key per click: a retried request (double click, flaky network) returns the same order.
      const order = await api.createOrder(planId, crypto.randomUUID());
      await navigate(`/orders/${order.id}`);
    } catch (e) {
      setFailure(e);
    } finally {
      setBuying(null);
    }
  };

  const error = failure === null ? null : describeError(failure, t.errors);

  return (
    <>
      <section className="hero">
        <h1 className="hero-title">{t.hero.title}</h1>
        <p className="lead">{t.hero.lead}</p>
        <a href="#plans" className="button">
          {t.hero.cta}
        </a>
        <span className="scroll-cue" aria-hidden="true">
          {t.hero.scroll}
        </span>
      </section>

      <Showcase />

      <section id="plans" className="plans">
        <h2 className="section-title reveal" ref={reveal}>
          {t.plans.title}
        </h2>
        <p className="lead reveal" ref={reveal}>
          {t.plans.lead}
        </p>
        {error && <p className="error">{error}</p>}
        {plans === null && !error && <p className="muted">{t.loading}</p>}
        <div className="grid">
          {plans?.map((plan, i) => (
            <article
              key={plan.id}
              className="card plan reveal"
              ref={reveal}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <h3>{t.plans.names[plan.id] ?? plan.name}</h3>
              <p className="price">{formatPrice(plan.priceCents)}</p>
              <p className="muted">{t.plans.days(plan.durationDays)}</p>
              <button
                type="button"
                className="button"
                disabled={buying !== null}
                onClick={() => void buy(plan.id)}
              >
                {buying === plan.id ? t.plans.buying : t.plans.buy}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
