# Lighthouse: after

- Версія (`/version`): `51efdf294639f907736ef3018d7d26f74a63cb1b` · 2026-11-09T12:09:06.794Z
- lighthouse@13.5.0, mobile preset (simulated throttling), 3 прогони на сторінку — медіана
- Відтворити: `make lighthouse` (стенд піднятий `make load`); сирі звіти — `reports/perf/lighthouse-after/`

## `/`

| Performance | Accessibility | Best Practices | SEO |
| ----------: | ------------: | -------------: | --: |
|         100 |           100 |            100 | 100 |

| FCP, мс | LCP, мс | TBT, мс | CLS | Speed Index, мс | Вага сторінки, КБ |
| ------: | ------: | ------: | --: | --------------: | ----------------: |
|    1356 |    1659 |       0 |  24 |            1356 |                90 |

CLS ×1000. Проблеми (аудити з оцінкою < 0,9, останній прогін):

- `unused-javascript` — Reduce unused JavaScript (Est savings of 50 KiB)
- `network-dependency-tree-insight` — Network dependency tree
- `render-blocking-insight` — Render-blocking requests (Est savings of 150 ms)

## `/login`

| Performance | Accessibility | Best Practices | SEO |
| ----------: | ------------: | -------------: | --: |
|         100 |           100 |            100 | 100 |

| FCP, мс | LCP, мс | TBT, мс | CLS | Speed Index, мс | Вага сторінки, КБ |
| ------: | ------: | ------: | --: | --------------: | ----------------: |
|    1354 |    1504 |       0 |   0 |            1354 |                90 |

CLS ×1000. Проблеми (аудити з оцінкою < 0,9, останній прогін):

- `unused-javascript` — Reduce unused JavaScript (Est savings of 53 KiB)
- `network-dependency-tree-insight` — Network dependency tree
- `render-blocking-insight` — Render-blocking requests (Est savings of 150 ms)
