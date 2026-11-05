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
```

Адмін створюється на старті з `ADMIN_EMAIL` / `ADMIN_PASSWORD`. За замовчуванням сервер слухає `127.0.0.1:3000`; у контейнері задайте `HOST=0.0.0.0`.

---

## 🧪 Команди

| Команда                                  | Що робить                                                                 |
| :--------------------------------------- | :------------------------------------------------------------------------ |
| `npm run smoke`                          | Усі сценарії spec через HTTP на in-memory даних (запускається в pre-push) |
| `npm run smoke:db`                       | Той самий сценарій на PostgreSQL + перевірка N+1                          |
| `npm run db:up` / `db:down` / `db:reset` | Підняти / зупинити / перестворити локальну БД                             |
| `npm run db:migrate`                     | Застосувати нові міграції                                                 |
| `npm run check`                          | lint + format:check + typecheck (те саме, що pre-commit)                  |
| `npm run build` / `npm start`            | Збірка в `dist/` і запуск                                                 |

Хуки: [pre-commit](./.husky/pre-commit) (lint-staged + typecheck), [pre-push](./.husky/pre-push) (build + smoke).

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
| Правила для AI-агента                                 | [`AGENTS.md`](./AGENTS.md)             |
