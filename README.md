# License & Config Hub

> Модульний бекенд-моноліт та високопродуктивний шлюз авторизації для десктопного ПЗ комп'ютерного зору (детекція об'єктів).

Розроблено в межах навчального курсу «Node.js» (Лабораторні роботи, КПІ ім. Ігоря Сікорського).

---

## 🛠 Технологічний стек

- **Runtime:** Node.js (v20+ LTS, ESM `"type": "module"`)
- **Мова:** TypeScript 5.7+ у суворому режимі (`strict`, `noImplicitAny`, без `any`)
- **HTTP Framework:** Fastify v5 (висока пропускна здатність, швидка валідація схем)
- **Валідація:** Zod / Fastify JSON Schema
- **Контроль якості:** ESLint 9 (flat config), Prettier
- **Git конвеєр:** Husky 9, lint-staged (блокування "брудних" комітів на рівні хуків)

---

## 🏛 Архітектура (Modular Monolith)

Система організована як модульний моноліт із суворим розділенням шарів (`Routes/Controller` $\rightarrow$ `Domain/Service` $\rightarrow$ `Data Access/Repository`):

```text
src/
├── modules/
│   ├── auth/          # Автентифікація, сесії, RBAC (User/Admin)
│   ├── licenses/      # Адміністрування ключів, статуси, активації
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

## 📑 Стандарти та артефакти репозиторію

- [`spec.md`](./spec.md) — Архітектурна специфікація системи, ER-діаграма та ключові сценарії.
- [`standards/definition-of-done.md`](./standards/definition-of-done.md) — Власний Definition of Done для задач.
- [`standards/spec-template.md`](./standards/spec-template.md) — Еталонний шаблон специфікації модулів.
- [`standards/adr/`](./standards/adr/) — Журнал архітектурних рішень (MADR):
  - [0001: Фіксація рішень через MADR](./standards/adr/0001-record-architecture-decisions.md)
  - [0002: Вибір Fastify над Express та NestJS](./standards/adr/0002-choose-fastify-over-express.md)
  - [0003: Межі модульного моноліту та ізоляція Loader](./standards/adr/0003-modular-monolith-boundary.md)
- [`DEFENSE.md`](./DEFENSE.md) — Документ для 5-хвилинного захисту лабораторної роботи перед викладачем.
