# DEFENSE — Завдання 2: сценарії на статиці → PostgreSQL, композиція, помилки

**Студент:** Осипенко Г. · **PR:** `feature/lab2-data-layer → main` · Захист Лаби 1 — [`docs/defense/lab1.md`](docs/defense/lab1.md)

**1. Що я просив у AI.** Спершу — проаналізувати стан репозиторію після Лаби 1 і навести лад. Потім — реалізувати всі сценарії [`spec.md`](spec.md) через HTTP API: спочатку на статичних даних, далі на PostgreSQL, за критеріями §4. Промпти й відповіді — [`ai/lab2/`](ai/lab2/), рев'ю виходу — [`ai/lab2/review.md`](ai/lab2/review.md).

**2. Топ-3 розбіжності spec ↔ вихід AI** (кожна виправлена спершу у вході — spec / AGENTS.md):

| #   | Що було не так (пункт spec)                                                                                                                       | Мій слід                                                   | Виправлення                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **N+1** в адмін-реєстрі (§4.8): сервіс брав email власника окремим запитом на кожен рядок. На статиці це непомітно, на БД — 9 запитів на 8 рядків | `review.md` §1 · правило в `AGENTS.md`                     | [`afab07d`](https://github.com/g-osypenko/nodejs-nzeta/commit/afab07d): read-model + `LEFT JOIN`, **2 запити** на сторінку з 20 рядків   |
| 2   | Видача ліцензії неіснуючому `userId`: memory → `201`, Postgres → `500` (§4.1, §3)                                                                 | `review.md` §2 · новий критерій §4.10 (`3d5d924`)          | [`ab41ee9`](https://github.com/g-osypenko/nodejs-nzeta/commit/ab41ee9): `404` на обох джерелах, перевірка в транзакції з `FOR KEY SHARE` |
| 3   | Клієнт отримував внутрішній `FST_ERR_CTP_BODY_TOO_LARGE` (§3)                                                                                     | `review.md` §3 · правило «лише коди з таблиці» (`3d5d924`) | [`ab41ee9`](https://github.com/g-osypenko/nodejs-nzeta/commit/ab41ee9): мапінг у глобальному обробнику → `413 PAYLOAD_TOO_LARGE`         |

**3. Ключові рішення.**

- **БД і доступ — [ADR 0004](docs/adr/0004-postgres-with-sql-tagged-templates.md).** PostgreSQL + `postgres` (SQL tagged templates), без ORM: `ON CONFLICT`, `FOR UPDATE` і умовний `UPDATE` пишуться напряму, а кількість запитів видно. Розглядалися Drizzle, Kysely, Prisma, `pg`.
- **Композиція — [ADR 0005](docs/adr/0005-composition-root-and-async-local-storage.md).** Ручний composition root ([`container.ts`](src/container.ts)) і AsyncLocalStorage для `requestId` / `processId` / `user`. Pino `mixin` додає їх у кожен лог. Розглядалися awilix, Effect, явне протягування `ctx`. Перехід зі статики на БД (`dafc25c`) не змінив жодного роуту чи сервісу.
- **Business-process ID.** Зберігається в `orders.process_id`; вебхук оплати приєднується до процесу замовлення, тож увесь checkout видно в логах під одним ID.

**4. Аудит даних.**

- **Ідемпотентність:**
  - `POST /orders` — `UNIQUE(user_id, idempotency_key)`;
  - вебхук — `event_id` як PK і одна транзакція з блокуванням замовлення;
  - handshake — один compare-and-set `UPDATE … WHERE hwid IS NULL` (два одночасні handshake → рівно один `BOUND`).
  - Лише такі операції ретраяться (`withRetry`) на `40001`/`40P01`/обриві з'єднання.
- **Збої джерела** (перевірено вручну, команди в README):
  - старт без БД → `exit 1` за ~0,7 с з причиною;
  - БД зупинено під час роботи → `503 DB_UNAVAILABLE` + `Retry-After`;
  - БД піднято → `200` без перезапуску процесу.
- **Зрізані кути / крайові випадки:**
  1. Вебхук `SUCCEEDED` після `FAILED` для того самого замовлення → `409`. Гроші можуть бути списані без ліцензії, потрібна ручна звірка.
  2. Адмінська видача ліцензії не ретраїться: вона не ідемпотентна, і при обриві після `COMMIT` результат невідомий.
  3. Прострочені сесії не чистяться.

  Також поза обсягом (spec §5): HMAC-підпис вебхука, JWT, rate limiting.

**5. Перевірка** (відтворювано):

```bash
npm run check && npm run build          # lint + format + typecheck + tsc — 0 помилок
npm run smoke                           # Smoke test passed: 45 checks on memory.
npm run db:up && npm run db:migrate     # Postgres 17 на 127.0.0.1:55432
npm run smoke:db                        # Smoke test passed: 46 checks on postgres.  (… 2 SQL queries for a page of 20 rows)
GIT_COMMIT=$(git rev-parse --short HEAD) npm start   # GET /version → {"status":"OK","commit":"<sha>"}
```
