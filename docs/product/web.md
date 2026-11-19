# Вебкабінет — продуктовий трек

Трек `product/*` (див. [`AGENTS.md`](../../AGENTS.md) §0). Архітектура — [ADR 0008](../adr/0008-frontend-react-same-origin.md).

## Що вже є (каркас, `product/web`)

| Сторінка          | Маршрут                   | API                                                                               |
| :---------------- | :------------------------ | :-------------------------------------------------------------------------------- |
| Тарифи + «Купити» | `/`                       | `GET plans`, `POST orders` (новий `Idempotency-Key` на клік)                      |
| Вхід за кодом     | `/login`, `/login/verify` | `POST auth/code`, `POST auth/code/verify`, `POST auth/link/verify`, `GET auth/me` |
| Мої ліцензії      | `/licenses`               | `GET licenses`                                                                    |
| Стан замовлення   | `/orders/:id`             | `GET orders/:id`                                                                  |

Запуск локально: `npm run dev` (API на `:3000`) + `npm run web:dev` → http://localhost:5173. Прод-збірка: `npm run web:build`, потім `WEB_DIST_DIR=web/dist npm start` → http://127.0.0.1:3000.

## Свідомі компроміси каркаса

- ~~Bearer-токен у `localStorage`~~ — з [ADR 0011](../adr/0011-passwordless-email-code-and-cookie-session.md) сесія в httpOnly-cookie, вхід за кодом з пошти. Листи поки пишуться в лог (`MAILER=console`): справжня відправка (Brevo) — коли буде домен.
- Немає тестів компонентів і e2e браузером.
- Немає сторінок конфігів (`configs`) і адмінки (`admin/licenses`), хоча API для них є.
- Замовлення лишається `PENDING`: справжнього платіжного провайдера немає (spec §7).
- Немає CSP і security-заголовків (helmet).

## Відкриті рішення (ухвалює власник продукту)

1. ~~**Сесія**~~ — вирішено: httpOnly-cookie + перевірка `Origin` ([ADR 0011](../adr/0011-passwordless-email-code-and-cookie-session.md)). Вхід паролем прибрано зовсім (крок 2 ADR 0011).
2. **CORS:** зараз `origin: true` — за same-origin його можна вимкнути взагалі або звузити до allowlist (лоадер ходить не з браузера, CORS йому не потрібен).
3. **Платіжний провайдер:** LiqPay / WayForPay / Stripe — підписаний вебхук (HMAC) замість спільного секрету.
4. **Тести фронту:** Vitest + Testing Library (компоненти) і Playwright (сценарій покупця) — у CI як окремий required check.
5. **VPS:** Caddy (HTTPS, статика `web/dist`, reverse proxy `/api` → 2 контейнери blue/green) — заміна кроку Render у CD.
