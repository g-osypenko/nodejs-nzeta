# License & Config Hub

> Модульний бекенд-моноліт (вітрина і продаж ліцензій, хмарні конфігурації) та високопродуктивний шлюз авторизації для десктопного ПЗ комп'ютерного зору (детекція об'єктів).

Розроблено в межах навчального курсу «Node.js» (Лабораторні роботи, КПІ ім. Ігоря Сікорського).

---

## 🛠 Технологічний стек

- **Runtime:** Node.js (v20+ LTS, ESM `"type": "module"`)
- **Мова:** TypeScript 5.7+ у суворому режимі (`strict`, `noImplicitAny`, без `any`)
- **HTTP Framework:** Fastify v5 (висока пропускна здатність, швидка валідація схем)
- **Валідація:** Zod
- **БД:** PostgreSQL 17 (Docker), драйвер `postgres` — SQL tagged templates, без ORM ([ADR 0004](./docs/adr/0004-postgres-with-sql-tagged-templates.md))
- **Логи:** pino з автоматичними `reqId` / `processId` / `userId` (AsyncLocalStorage)
- **Контроль якості:** ESLint 10 (flat config), Prettier
- **Git конвеєр:** Husky 9, lint-staged (блокування "брудних" комітів на рівні хуків)

---

## 🏛 Архітектура (Modular Monolith)

Шари `routes` (HTTP + Zod) → `service` (бізнес-правила, доступ) → `repository` (дані). Кожен репозиторій має дві реалізації: in-memory (статичний прототип) і PostgreSQL. Реалізацію обирає `DATA_SOURCE`, без змін у роутах і сервісах ([ADR 0005](./docs/adr/0005-composition-root-and-async-local-storage.md)).

```text
src/
├── modules/
│   ├── auth/          # реєстрація, вхід, сесії (scrypt + sha256 токенів), ролі USER/ADMIN
│   ├── licenses/      # тарифи, замовлення з Idempotency-Key, вебхук оплати, адмін-реєстр
│   ├── configs/       # JSON-профілі клієнта (upsert за назвою)
│   └── loader/        # handshake лоадера: атомарна прив'язка HWID (SLA < 15 мс)
├── shared/            # config, context (AsyncLocalStorage), logger, errors, db (pool, retry, migrate)
├── container.ts       # composition root: ресурси → репозиторії → сервіси
├── app.ts             # Fastify: хуки контексту, глобальний обробник помилок, роути /api/v1
├── index.ts           # старт (fail fast) і graceful shutdown
└── smoke.ts           # усі сценарії spec через HTTP
migrations/            # SQL-міграції
```

Сценарії, схема БД, коди помилок і критерії прийняття — у [`spec.md`](./spec.md).

---

## 🚀 Швидкий старт

```bash
npm install
cp .env.example .env

# PostgreSQL у Docker (порт 55432)
npm run db:up && npm run db:migrate
npm run dev

# без БД: у .env поставте DATA_SOURCE=memory (статичні дані в пам'яті)

# фронтенд (React + Vite, ADR 0008) — у другому терміналі → http://localhost:5173
npm run web:install && npm run web:dev
```

Адмін створюється на старті з `ADMIN_EMAIL` / `ADMIN_PASSWORD`. За замовчуванням сервер слухає `127.0.0.1:3000`; у контейнері задайте `HOST=0.0.0.0`.

---

## 🧪 Команди

| Команда                                       | Що робить                                                                 |
| :-------------------------------------------- | :------------------------------------------------------------------------ |
| `npm run smoke`                               | Усі сценарії spec через HTTP на in-memory даних (запускається в pre-push) |
| `npm run smoke:db`                            | Той самий сценарій на PostgreSQL + перевірка N+1                          |
| `npm run db:up` / `db:down` / `db:reset`      | Підняти / зупинити / перестворити локальну БД                             |
| `npm run db:migrate [-- --phase=…]`           | Міграції: усі фази або одна (`schema` / `data` / `indexes`), ADR 0007     |
| `npm run db:seed [-- --users=N --licenses=N]` | Демо-дані (детерміновані, ідемпотентні) — окремо від міграцій             |
| `npm test`                                    | Unit-тести (без Docker, < 1 с; запускаються в pre-push)                   |
| `npm run test:integration`                    | Інтеграційні тести на свіжому Postgres у Testcontainers (потрібен Docker) |
| `npm run test:e2e`                            | Збірка + E2E на процесі `node dist/index.js` з реальною БД                |
| `npm run test:coverage`                       | Покриття unit + integration з порогами spec §6 → `reports/coverage/`      |
| `npm run test:mutation`                       | Мутаційне тестування Stryker → `reports/mutation/` (= `make mutation`)    |
| `npm run check`                               | lint + format:check + typecheck (те саме, що pre-commit)                  |
| `npm run build` / `npm start`                 | Збірка в `dist/` і запуск                                                 |

Хуки: [pre-commit](./.husky/pre-commit) (lint-staged + typecheck), [commit-msg](./.husky/commit-msg) (commitlint), [pre-push](./.husky/pre-push) (build + unit + smoke). Звіти тестування — [`docs/testing/`](./docs/testing/).

---

## 🚢 CI/CD і стейдж

[`ci.yml`](./.github/workflows/ci.yml): на кожен PR — `check` · `build` · `test` · `commits` · `docker` (required checks, без них мердж у `main` заблоковано). Мердж у `main` → образ `ghcr.io/g-osypenko/nodejs-nzeta:<sha>` → міграції (3 кроки) → Render → очікування `/version == <sha>` → smoke. Деталі — [spec §8](./spec.md), [ADR 0006](./docs/adr/0006-ci-cd-github-actions-render-neon.md), [ADR 0007](./docs/adr/0007-zero-downtime-migrations.md).

```bash
make docker      # зібрати образ локально з поточним SHA
make docker-run  # запустити його (in-memory) на http://127.0.0.1:3999 → /version
```

<details>
<summary>Одноразове налаштування стейджу (Neon + Render + GitHub)</summary>

1. **Neon** → новий проєкт, Postgres 17, регіон Frankfurt. Скопіювати **direct** connection string (вимкнути «Connection pooling»), прибрати з нього `&channel_binding=require`, лишити `?sslmode=require` (spec §8.5).
2. **GitHub** → Settings → Environments → `staging`:
   - secret `STAGING_DATABASE_URL` = рядок з п. 1;
   - secret `RENDER_DEPLOY_HOOK` = з п. 4;
   - variable `STAGING_URL` = `https://<сервіс>.onrender.com` (без `/` у кінці).
3. **Перший образ:** Actions → `ci` → Run workflow (будь-яка гілка) → job `docker` публікує `ghcr.io/g-osypenko/nodejs-nzeta:<sha>`. GitHub → Packages → `nodejs-nzeta` → Package settings → Change visibility → **Public** (щоб Render міг тягнути образ без токена).
4. **Схема до першого старту** (застосунок сам не мігрує, а без таблиць не стартує): `DATABASE_URL='<рядок з п. 1>' npm run db:migrate`, за бажанням `npm run db:seed`.
5. **Render** → New → Web Service → Existing Image → `ghcr.io/g-osypenko/nodejs-nzeta:<sha>`, Instance type **Free**, регіон Frankfurt.
   - Environment: `DATA_SOURCE=postgres`, `DATABASE_URL` (з п. 1), `WEBHOOK_SECRET` (≥ 16 символів), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `LOG_LEVEL=info`.
   - Settings → Health Check Path = `/health`. Settings → Deploy Hook → скопіювати в `RENDER_DEPLOY_HOOK` (п. 2).

</details>

---

## 📑 Документи репозиторію

| Що                                                    | Де                                     |
| :---------------------------------------------------- | :------------------------------------- |
| Специфікація (сценарії, схема БД, критерії прийняття) | [`spec.md`](./spec.md)                 |
| Захист поточної лабораторної                          | [`DEFENSE.md`](./DEFENSE.md)           |
| Архів захистів попередніх лаб                         | [`docs/defense/`](./docs/defense/)     |
| Архітектурні рішення (MADR)                           | [`docs/adr/`](./docs/adr/)             |
| Власні стандарти: Definition of Done, шаблон spec     | [`docs/standards/`](./docs/standards/) |
| Слід роботи з AI: промпти, відповіді, рев'ю виходу    | [`ai/`](./ai/)                         |
| Продуктовий трек: вебкабінет, відкриті рішення        | [`docs/product/`](./docs/product/)     |
| Правила для AI-агента                                 | [`AGENTS.md`](./AGENTS.md)             |
