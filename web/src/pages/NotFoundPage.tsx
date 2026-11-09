import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function NotFoundPage(): ReactElement {
  return (
    <section className="narrow">
      <h1>Сторінку не знайдено</h1>
      <p>
        <Link to="/">На головну</Link>
      </p>
    </section>
  );
}
