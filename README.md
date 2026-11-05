# License & Config Hub

> Модульний бекенд-моноліт (вітрина і продаж ліцензій, хмарні конфігурації) та високопродуктивний шлюз авторизації для десктопного ПЗ комп'ютерного зору (детекція об'єктів).

Розроблено в межах навчального курсу «Node.js» (Лабораторні роботи, КПІ ім. Ігоря Сікорського).

---

## 🛠 Технологічний стек

- **Runtime:** Node.js (v20+ LTS, ESM `"type": "module"`)
- **Мова:** TypeScript 5.7+ у суворому режимі (`strict`, `noImplicitAny`, без `any`)
- **HTTP Framework:** Fastify v5 (висока пропускна здатність, швидка валідація схем)
- **Валідація:** Zod / Fastify JSON Schema
- **Контроль якості:** ESLint 10 (flat config), Prettier
- **Git конвеєр:** Husky 9, lint-staged (блокування "брудних" комітів на рівні хуків)

---

## 🏛 Архітектура (Modular Monolith)

Система організована як модульний моноліт із суворим розділенням шарів (`Routes/Controller` $\rightarrow$ `Domain/Service` $\rightarrow$ `Data Access/Repository`):

```text
src/
├── modules/
│   ├── auth/          # Автентифікація, сесії, RBAC (User/Admin)
│   ├── licenses/      # Вітрина планів, онлайн-продаж (checkout), адміністрування ключів
│   ├── configs/       # Зберігання та валідація JSON-профілів
│   └── loader/        # Критичний stateless-шлюз handshake (SLA < 15ms)
├── shared/            # Загальні сервіси (DB, доменні помилки, логер)
├── app.ts             # Фабрика Fastify (buildApp, плагіни, CORS)
└── index.ts           # Точка входу середовища (listen, smoke test)
```

Детальний опис сутностей та ER-діаграма знаходяться у файлі [`spec.md`](./spec.md).

---

## 🚀 Швидкий старт

### Встановлення залежностей

```bash
npm install
```

### Запуск у режимі розробки (Hot-reload)

```bash
npm run dev
```

### Збірка та запуск продакшн

```bash
npm run build
npm start
```

---

## 🧪 Перевірка якості та команди конвеєра

Усі перевірки автоматизовані через `git-hooks` ([.husky/pre-commit](./.husky/pre-commit) та [.husky/pre-push](./.husky/pre-push)):

| Команда                | Опис дії                                                        |
| :--------------------- | :-------------------------------------------------------------- |
| `npm run smoke`        | Автономний smoke-тест (перевірка готовності екземпляра сервера) |
| `npm run typecheck`    | Сувора перевірка типів TypeScript (`tsc --noEmit`)              |
| `npm run lint`         | Статичний аналіз коду ESLint                                    |
| `npm run lint:fix`     | Автоматичне виправлення проблем лінтера                         |
| `npm run format:check` | Перевірка форматування коду Prettier                            |
| `npm run format:write` | Автоматичне форматування коду Prettier                          |
| `npm run build`        | Компіляція TypeScript у директорію `dist/`                      |

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
