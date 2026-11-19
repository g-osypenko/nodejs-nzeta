import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';

export function NotFoundPage(): ReactElement {
  const { t } = useI18n();
  return (
    <section className="narrow">
      <h1>{t.notFound.title}</h1>
      <p>
        <Link to="/">{t.notFound.home}</Link>
      </p>
    </section>
  );
}
