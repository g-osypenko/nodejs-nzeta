# DEFENSE: Лабораторна робота №1

**Студент:** Осипенко Г.  
**Тема:** Фундамент і структура застосунку  
**Проєкт:** License & Config Hub (Backend & Gateway для десктопного ПЗ комп'ютерного зору)  
**Pull Request:** `feature/scaffolding` $\rightarrow$ `main`

---

## 1. Що і навіщо

- **Що:** Закладено архітектурний каркас модульного моноліту (вітрина і онлайн-продаж ліцензій, адміністрування ключів, хмарні конфігурації, шлюз авторизації лоадера) на Fastify та TypeScript Strict, розроблено власні інженерні стандарти (DoD, MADR, spec-template) та налаштовано нерозривний конвеєр Git-хуків (Husky, lint-staged).
- **Навіщо:** Забезпечити абсолютну надійність шлюзу авторизації клієнтського лоадера та процесу продажу ліцензій, виключити потрапляння нетипізованого або невідформатованого коду в репозиторій та підготувати ґрунт під навантажувальне тестування.

---

## 2. Топ-3 розбіжності / «зрізані кути» (проти spec)

| №     | Зрізаний кут / Розбіжність                                                                                                                                                      | Причина компромісу                                                                                                                               | Коміт фіксації                                                         |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **1** | **Відсутність фізичного підключення до БД (PostgreSQL / Drizzle):** У `spec.md` описано сутності `USERS`, `LICENSES`, `USER_CONFIGS`, проте шар БД у коді ще не піднято.        | Лабораторна 1 фокусується виключно на конвеєрі якості, хуках та структурі. Підключення Drizzle ORM та міграції свідомо винесено в Лабораторну 2. | [`39a7635`](https://github.com/g-osypenko/nodejs-nzeta/commit/39a7635) |
| **2** | **Stateless-отримання коміту в `/version` через `process.env`:** Замість виконання синхронного `git rev-parse HEAD` у рантаймі використовується `GIT_COMMIT ?? 'dev-local'`.    | Уникнення блокування Event Loop процесом `child_process.execSync` та запобігання падінню сервісу в контейнерах, де `.git` відсутній.             | [`a319dca`](https://github.com/g-osypenko/nodejs-nzeta/commit/a319dca) |
| **3** | **Відсутність фізичних файлів контролерів у `src/modules/*`:** Межі модулів (`auth`, `licenses`, `configs`, `loader`) зафіксовані в архітектурі, але ще не мають бізнес-файлів. | Уникнення створення порожніх заглушок (dummy files) до повноцінного проєктування контрактів даних у Лабораторній 2.                              | [`39a7635`](https://github.com/g-osypenko/nodejs-nzeta/commit/39a7635) |

---

## 3. Ключове архітектурне рішення (ADR)

- **Рішення:** Вибір **Fastify** замість Express.js та NestJS ([ADR 0002](../adr/0002-choose-fastify-over-express.md)).
  - _Альтернативи:_ Express.js (відхилено через низьку пропускну здатність та відсутність вбудованої компіляції схем), NestJS (відхилено через оверхед рефлексії/декораторів та складнощі профілювання низькорівневих ботлнеків у Лабораторній 5).
  - _Чому Fastify:_ Компіляція схем валідації (`fast-json-stringify` / `Ajv`), мінімальний оверхед для високочастотного шлюзу `loader` (SLA < 15ms) та нативна плагінна інкапсуляція.
- **Розподіл модулів:** Ізоляція `loader` від `licenses` ([ADR 0003](../adr/0003-modular-monolith-boundary.md)) для захисту критичного шляху перевірки від навантаження адмін-панелі.

---

## 4. Перевірка системи та артефакти запуску

### Команди відтворення:

```bash
npm run smoke          # Результат: "Smoke test passed: server instantiates without errors."
npm run typecheck      # Результат: tsc --noEmit (0 помилок, strict mode)
npm run lint           # Результат: eslint . (0 помилок, заборона any)
npm run format:check   # Результат: All matched files use Prettier code style!
```

_(Або через `make all` / `make smoke`)_

### Службовий ендпоінт перевірки версії:

`GET /version` $\rightarrow$ `HTTP/1.1 200 OK`

```json
{
  "status": "OK",
  "commit": "a319dca"
}
```

---

## 5. Доказ блокування «брудного» коміту Git-хуком

При спробі закомітити код із порушенням правил типізації (`any`) хук `.husky/pre-commit` гарантовано відхиляє коміт:

```text
$ git commit -m "test: dirty commit"
⋯ Backing up original state…
✔ Done backing up original state (d91685c)!
⋯ Running tasks for staged files…
    *.ts — 1 file
      ⋯ prettier --write
      ⋯ eslint --fix

✔ prettier --write
✖ eslint --fix

✖ Failed to run tasks for staged files!
↓ Skipped staging changes from tasks…
⋯ Reverting to original state because of errors…
✔ Done reverting to original state!
⋯ Cleaning up temporary files…
✔ Done cleaning up temporary files!

✖ eslint --fix:

C:\UNI-reps\nodejs-nzeta\src\app.ts
  20:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 1 problem (1 error, 0 warnings)
husky - pre-commit script failed (code 1)
```
