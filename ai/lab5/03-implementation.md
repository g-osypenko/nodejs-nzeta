# Lab 5 · 03 — Реалізація: стенд, виміри, `@lch/auth-core`, фронт

Дата: 2026-11-09 · Агент: Claude Code (Opus) · Вхід: spec §9, рішення студента ([`02-findings.md`](02-findings.md))

| #   | Що                                                                                                  | Коміти                                     |
| :-- | :-------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| 1   | spec §9: сценарії, метод, SLA, критерії                                                             | `cb95049`                                  |
| 2   | `GET /debug/runtime` (CPU, ELU, затримка event loop, RSS) лише з `DEBUG_RUNTIME`                    | `ef46b87`, `04f8edc`                       |
| 3   | Стенд `perf/compose.yml`, k6-сценарії, оркестратор; storm; метрики за типом запиту                  | `76316bf`, `a2a0d6b`, `1850823`, `27b5c46` |
| 4   | `make explain` (SQL перехоплено з репозиторіїв), `make profile`, `make lighthouse`                  | `76316bf`…`895cd2d`                        |
| 5   | Базова лінія до змін (`27b5c46`) — load, sweep, EXPLAIN, профіль, Lighthouse                        | `0bf02b8`                                  |
| 6   | `packages/auth-core`: контракт, DI, хешувальник з admission control, тести на фейках, лінт межі     | `e45e83d`                                  |
| 7   | Хост: адаптери (scrypt, SHA-256, ALS), мапінг `AuthError` → spec §3, `AUTH_BUSY` 503, конфіг        | `96edc6b`                                  |
| 8   | Docker: збірка й постачання workspace-пакета                                                        | `57a1bed`                                  |
| 9   | Фронт: повідомлення `AUTH_BUSY`; передстиснення brotli/gzip; lazy-маршрути — спробувано й відкинуто | `f9a54c3`, `dc390f1`                       |
| 10  | Виміри після (`51efdf2`)                                                                            | `f94d96c`                                  |

**Перевірено:** `npm run check`, `npm run build` (пакет → застосунок), smoke 45/45, 246 тестів (unit + integration) з порогом 100 % для `packages/auth-core`, e2e 5/5, образ стартує й логінить через `dist/` пакета. Підсумок до/після — [`docs/perf/README.md`](../../docs/perf/README.md).
