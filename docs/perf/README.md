# Продуктивність: підсумок Завдання 5

Стенд: застосунок 1 vCPU / 512 МБ, Postgres 17, k6 (відкрита модель), 2 000 користувачів / 200 000 ліцензій ([ADR 0009](../adr/0009-performance-measurement-tooling.md)). Числа — медіана 5 повторів (min–max — у файлах).

| Звіт            | До (`27b5c46`)                                     | Після (`51efdf2`)                            |
| :-------------- | :------------------------------------------------- | :------------------------------------------- |
| Навантаження    | [`load-baseline.md`](load-baseline.md)             | [`load-after.md`](load-after.md)             |
| Насичення       | [`load-sweep.md`](load-sweep.md)                   | [`load-sweep-after.md`](load-sweep-after.md) |
| CPU-профіль     | [`profile-baseline.md`](profile-baseline.md)       | [`profile-after.md`](profile-after.md)       |
| EXPLAIN ANALYZE | [`explain-baseline.md`](explain-baseline.md)       | без змін SQL — не переміряно                 |
| Lighthouse      | [`lighthouse-baseline.md`](lighthouse-baseline.md) | [`lighthouse-after.md`](lighthouse-after.md) |

## Боттлнек 1 — `auth`: scrypt забирає єдиний CPU (виправлено, ADR 0010)

| Метрика                                             |       До |                            Після |
| :-------------------------------------------------- | -------: | -------------------------------: |
| `storm` (400 handshake + 60 login/с): handshake p99 |  85,9 мс |           **34,9 мс** (SLA ≤ 50) |
| `storm`: handshake p95                              |  79,7 мс |                          28,0 мс |
| `storm`: login p99                                  | 6 401 мс |                       **287 мс** |
| `storm`: dropped iterations                         |      544 |                            **0** |
| `storm`: затримка event loop p99                    |  80,7 мс |                          30,8 мс |
| `storm`: відмови `503 AUTH_BUSY`                    |        — |   5,9 % запитів (≈ 45 % логінів) |
| `login` 80 RPS: p99                                 | 7 116 мс |          269 мс (51 % відсічено) |
| `login` 20 RPS: p99                                 |  26,8 мс | 34,4 мс — ціна черги (SLA ≤ 500) |

**Чому саме тут.** Login коштує ≈ 23 мс CPU (CPU 47 % при 20 RPS), але ELU лише 2 %: scrypt виконується в потоках libuv, тож CPU-профіль main thread його не бачить. Без обмеження до 4 потоків scrypt витісняли event loop: затримка event loop p99 81 мс. Рішення: не більше 1 scrypt одночасно, черга 8, решта — миттєве `503` + `Retry-After: 1`.

**Що лишилося.** На 1 vCPU потік scrypt і event loop ділять ядро, тож handshake p95 під storm — 28 мс (без storm — 0,8 мс). Ідеалу на одному ядрі не досягти. На ≥ 2 ядрах ця конкуренція зникає.

## Боттлнек 2 — фронт: статика без стиснення (виправлено)

| `/` (mobile) |    До | Після |
| :----------- | ----: | ----: |
| Performance  |    92 |   100 |
| FCP, мс      | 2 555 | 1 356 |
| LCP, мс      | 2 707 | 1 659 |
| Передано, КБ |   324 |    90 |

Brotli і gzip готуються на етапі збірки (`web/scripts/compress.mjs`), тож CPU на запит не витрачається. **Відкинуто за цифрами:** lazy-маршрути заради `unused-javascript` — усі сторінки разом ≈ 6 КБ із 323 КБ, решта — сам React. Виграш 2 % не вартий мерехтіння й зайвого round-trip.

## Боттлнек 3 — `admin`: OFFSET-пагінація (знайдено, свідомо не виправлено)

`EXPLAIN`: offset 0 — 0,2 мс, 100 000 — 26 мс, 199 950 — 53 мс, тобто лінійно від глибини сторінки (Postgres читає й відкидає всі попередні рядки). Навантаження: p95 28 мс при CPU 3 % — це очікування БД. Операція рідкісна (адмін) і поки в межах розумного. Виправлення — keyset-пагінація (`WHERE created_at < $cursor`), але це зміна контракту API spec §1.

## Що виміри спростували

- **Кеш для `loader`** (план spec §7 з Лаби 2) не потрібен: handshake лінійний до 1 440 RPS (p99 2,7 мс), `findByKey` — Index Scan 0,04 мс. Профіль: наш код — 4,5 % часу main thread, решта — запис у сокети й драйвер postgres.
- **Lazy-маршрути** — див. вище.
