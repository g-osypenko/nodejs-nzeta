# DEFENSE — Завдання 4: CI, що блокує мердж, і CD на стейдж

**Студент:** Осипенко Г. · **PR:** [#4](https://github.com/g-osypenko/nodejs-nzeta/pull/4) `feature/lab4-ci-cd → main` · Попередні захисти — [`docs/defense/`](docs/defense/)

**1. Що я просив у AI.** За [`spec.md`](spec.md) §8 зібрати CI, який блокує мердж, і CD на стейдж з міграціями без простою. Стейдж — Render + Neon, без оренди VPS: це моє рішення, варіанти в [`ai/lab4/01-kickoff.md`](ai/lab4/01-kickoff.md). Промпти — [`ai/lab4/`](ai/lab4/), рев'ю — [`review.md`](ai/lab4/review.md).

**2. Топ-3 розбіжності** (кожна виправлена у вході — `AGENTS.md`):

| #   | Що було не так (проти spec / `AGENTS.md`)                                                                                          | Мій слід                                                                                    | Виправлення                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CLI seed у `shared/` імпортував `modules/auth`: межі шарів (§3)                                                                    | `review.md` §1                                                                              | [`a07b2c4`](https://github.com/g-osypenko/nodejs-nzeta/commit/a07b2c4) → `src/seed.ts`; правило [`40809a1`](https://github.com/g-osypenko/nodejs-nzeta/commit/40809a1)     |
| 2   | SHA GitHub Action узято з пам'яті, не з реєстру: закріплення за SHA втрачає сенс                                                   | `review.md` §2                                                                              | [`4f759eb`](https://github.com/g-osypenko/nodejs-nzeta/commit/4f759eb); правило [`40809a1`](https://github.com/g-osypenko/nodejs-nzeta/commit/40809a1)                     |
| 3   | Перший справжній прогін CI — червоний: флакі тест Лаби 3 (±50 мс за справжнім годинником) і `curl \| jq` без `pipefail` у кроці CI | [run](https://github.com/g-osypenko/nodejs-nzeta/actions/runs/42586051439) · `review.md` §3 | [`e2d15a8`](https://github.com/g-osypenko/nodejs-nzeta/commit/e2d15a8), [`9976c42`](https://github.com/g-osypenko/nodejs-nzeta/commit/9976c42) (pipefail на весь workflow) |

**3. Ключові рішення.**

- **Деплоїться перевірений артефакт.** Job `docker` збирає образ один раз, перевіряє `/version` у контейнері й публікує `ghcr.io/…:<sha>`. Render отримує саме цей тег через deploy hook, а не збирає ще раз ([ADR 0006](docs/adr/0006-ci-cd-github-actions-render-neon.md)).
- **Міграції — 3 фази, 3 кроки CD, до перемикання трафіку.** `schema` з `lock_timeout` і повторами; `data` пакетами в окремих транзакціях; `indexes` — `CONCURRENTLY` з прибиранням `INVALID`. Застосунок на старті не мігрує ([ADR 0007](docs/adr/0007-zero-downtime-migrations.md)).
- **Blue-green** — zero-downtime deploy Render за health check `/health`. `wait-for-version.sh` падає, якщо під час перемикання була хоч одна не-200 відповідь.

**4. Перевірка.**

| Що                                | Доказ                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI зелений на чистому PR          | [run 42586442587](https://github.com/g-osypenko/nodejs-nzeta/actions/runs/42586442587): `check` · `build` · `test` · `commits` · `docker`                                                                                                                                                                           |
| CI блокує брудний PR (критерій 1) | [PR #5](https://github.com/g-osypenko/nodejs-nzeta/pull/5), коміти через API без хуків: баг HWID → `test` ✖ (12 тестів) і `build` ✖ (smoke); не-conventional → `commits` ✖; `any` → `check` ✖; `TS2322` → `docker` ✖ — [run](https://github.com/g-osypenko/nodejs-nzeta/actions/runs/42586798834), стан **BLOCKED** |
| Branch protection                 | 5 required checks, strict, PR обов'язковий, без force-push                                                                                                                                                                                                                                                          |
| Фази міграцій (критерій 4)        | `npm run test:integration` → [`migrations.test.ts`](test/integration/migrations.test.ts): 4 пакети = 4 транзакції; `INVALID`-індекс перебудовано; `55P03` під блокуванням                                                                                                                                           |
| CD + `/version` (критерії 2–3)    | **TODO після налаштування стейджу:** посилання на run `deploy (staging)` · `GET https://<стейдж>/version` → `<sha мердж-коміта>`                                                                                                                                                                                    |

```bash
make ci            # те саме, що required checks (потрібен Docker)
make docker && make docker-run   # → http://127.0.0.1:3999/version = поточний SHA
```
