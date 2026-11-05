# Lab 1 · Промпт 02 — покрокова задача на Завдання 1

Задача, поставлена агенту на Завдання 1 (дослівно, без змін). Вихід агента — коміти `4d08981`…`d5ebed6`.

```text
Завдання 1 — Фундамент і структура застосунку

Мета

Закласти архітектурний каркас проєкту, налаштувати автоматизовані інженерні стандарти контролю якості коду (лінтери, типізація, git-hooks) та зафіксувати декомпозицію системи в spec.md і MADR.

1. Специфікація вимог до задачі

Формат здачі:

Посилання на GitHub Pull Request: feature/scaffolding -> main.

Файл захисту DEFENSE.md у корені репозиторію.

Оцінювання: Вчасно — 16 балів, поза строком — 10 балів.

Критерій відмінного виконання: Стандарти надійні й автономні; конвеєр pre-commit/pre-push блокує «брудні» коміти; архітектура коду чітко відповідає spec.md, межі модулів обґрунтовані.

2. Покроковий план виконання

Крок 1. Ініціалізація та інструменти розробки

Ініціалізувати репозиторій:

git init
git checkout -b main
# Створити початковий пустий коміт і відбрунькувати гілку для роботи
git checkout -b feature/scaffolding


Налаштувати package.json з type: "module", встановити залежності:

Prod: fastify, @fastify/cors, dotenv, zod.

Dev: typescript, @types/node, tsx, eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin, prettier, husky, lint-staged.

Налаштувати строгий tsconfig.json:

"strict": true

"noImplicitAny": true

"strictNullChecks": true

"skipLibCheck": true

Крок 2. Налаштування форматування та статичного аналізу

Створити .prettierrc (форматування: semi, singleQuote, tabWidth: 2, trailingComma: all).

Створити .eslintrc.cjs з правилами TypeScript та імпортів.

Додати команди в package.json:

"scripts": {
  "lint": "eslint . --ext .ts",
  "lint:fix": "eslint . --ext .ts --fix",
  "format:check": "prettier --check .",
  "format:write": "prettier --write .",
  "typecheck": "tsc --noEmit",
  "build": "tsc",
  "smoke": "tsx src/index.ts --smoke-test"
}


Крок 3. Git-хуки (Husky + lint-staged)

Налаштувати Husky:

npx husky init


Створити конфігурацію .lintstagedrc.json:

{
  "*.ts": [
    "prettier --write",
    "eslint --fix"
  ]
}


Налаштувати хук .husky/pre-commit:

Запуск npx lint-staged

Запуск npm run typecheck

Налаштувати хук .husky/pre-push:

Запуск npm run build

Запуск мінімального smoke-тесту (перевірка, що сервер інстанціюється без помилок).

Крок 4. Створення стандартів (standards/)

standards/spec-template.md: еталонний шаблон специфікації модулів системи.

standards/definition-of-done.md: правила завершеності завдання (типів немає з any, лінтер зелений, тести покривають сценарій, хуки відпрацювали).

standards/adr/:

Створити 0001-record-architecture-decisions.md (MADR формат).

Створити 0002-choose-fastify-over-express.md (обґрунтування вибору Fastify: швидкість схемної валідації для шлюзу лоадера та оптимізація під Лабу 5).

Створити 0003-modular-monolith-boundary.md (межі модулів auth, licenses, configs, loader).

Крок 5. Головний spec.md у корені

Описати компоненти:

Auth Module: вхід, токени.

License & Admin Module: генерація та моніторинг ключів, HWID, email.

Config Module: зберігання та віддача JSON-конфігів клієнта.

Loader Gateway: швидкий stateless-ендпоінт для верифікації та прив'язки.

Діаграма сутностей (ER) у форматі Mermaid.

Опис ключових сценаріїв: купівля/видача ключа, перший запуск лоадера (первинна прив'язка HWID), повторний запуск лоадера (валідація), завантаження конфігу користувачем.

Крок 6. Аудит структури та залежностей

Зафіксувати аналіз топ-3 бібліотек, які свідомо НЕ додавалися до проєкту:

Express: відкинутий на користь Fastify через нижчу швидкодію та гіршу вбудовану валідацію схем.

NestJS: відкинутий через надмірний оверхед декораторів та складність ручного профілювання низькорівневих ботлнеків.

Bcrypt: відкинутий на етапі структури на користь нативного node:crypto (scrypt), щоб уникнути важких бінарних компіляцій на етапі CI.

3. Чек-лист для захисту (DEFENSE.md)

[ ] Доказ блокування «брудного» коміту: скріншот або консольний вивід, де git commit відхиляється через помилку форматування або тайпчеку.

[ ] Обґрунтування меж модулів: пояснити викладачеві, чому loader відокремлений від licenses (шлюз лоадера є критичним шляхом з іншими вимогами до навантаження).

[ ] PR: наявність відкритого/злитого PR feature/scaffolding -> main з конвенційними повідомленнями комітів.
```
