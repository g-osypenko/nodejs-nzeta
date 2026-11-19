# Вебкабінет — продуктовий трек

Трек `product/*` (див. [`AGENTS.md`](../../AGENTS.md) §0). Архітектура — [ADR 0008](../adr/0008-frontend-react-same-origin.md).

## Що вже є (каркас, `product/web`)

| Сторінка          | Маршрут               | API                                                          |
| :---------------- | :-------------------- | :----------------------------------------------------------- |
| Тарифи + «Купити» | `/`                   | `GET plans`, `POST orders` (новий `Idempotency-Key` на клік) |
| Вхід / реєстрація | `/login`, `/register` | `POST auth/login`, `POST auth/register`, `GET auth/me`       |
| Мої ліцензії      | `/licenses`           | `GET licenses`                                               |
| Стан замовлення   | `/orders/:id`         | `GET orders/:id`                                             |

Запуск локально: `npm run dev` (API на `:3000`) + `npm run web:dev` → http://localhost:5173. Прод-збірка: `npm run web:build`, потім `WEB_DIST_DIR=web/dist npm start` → http://127.0.0.1:3000.

## Свідомі компроміси каркаса

- Bearer-токен у `localStorage` (XSS може його прочитати).
- Немає тестів компонентів і e2e браузером.
- Немає сторінок конфігів (`configs`) і адмінки (`admin/licenses`), хоча API для них є.
- Замовлення лишається `PENDING`: справжнього платіжного провайдера немає (spec §7).
- Немає CSP і security-заголовків (helmet).

## Відкриті рішення (ухвалює власник продукту)

1. **Сесія:** httpOnly-cookie `SameSite=Strict` (захист від XSS-крадіжки; потрібен CSRF-захист для мутацій) **або** Bearer у пам'яті + refresh-cookie. Same-origin уже зроблено, тож обидва варіанти дешеві.
2. **CORS:** зараз `origin: true` — за same-origin його можна вимкнути взагалі або звузити до allowlist (лоадер ходить не з браузера, CORS йому не потрібен).
3. **Платіжний провайдер:** LiqPay / WayForPay / Stripe — підписаний вебхук (HMAC) замість спільного секрету.
4. **Тести фронту:** Vitest + Testing Library (компоненти) і Playwright (сценарій покупця) — у CI як окремий required check.
5. **VPS:** Caddy (HTTPS, статика `web/dist`, reverse proxy `/api` → 2 контейнери blue/green) — заміна кроку Render у CD.
