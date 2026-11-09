# Lighthouse: baseline

- Версія (`/version`): `27b5c460cef8d429612ab3ac30c002cae61e58d8` · 2026-11-09T11:28:15.907Z
- lighthouse@13.5.0, mobile preset (simulated throttling), 3 прогони на сторінку — медіана
- Відтворити: `make lighthouse` (стенд піднятий `make load`); сирі звіти — `reports/perf/lighthouse-baseline/`

## `/`

| Performance | Accessibility | Best Practices | SEO |
| ----------: | ------------: | -------------: | --: |
|          92 |           100 |            100 | 100 |

| FCP, мс | LCP, мс | TBT, мс | CLS | Speed Index, мс | Вага сторінки, КБ |
| ------: | ------: | ------: | --: | --------------: | ----------------: |
|    2555 |    2707 |       0 |  24 |            2555 |               324 |

CLS ×1000. Проблеми (аудити з оцінкою < 0,9, останній прогін):

- `unused-javascript` — Reduce unused JavaScript (Est savings of 184 KiB)
- `network-dependency-tree-insight` — Network dependency tree
- `render-blocking-insight` — Render-blocking requests (Est savings of 150 ms)
- `first-contentful-paint` — First Contentful Paint (2.6 s)
- `largest-contentful-paint` — Largest Contentful Paint (2.7 s)

## `/login`

| Performance | Accessibility | Best Practices | SEO |
| ----------: | ------------: | -------------: | --: |
|          93 |           100 |            100 | 100 |

| FCP, мс | LCP, мс | TBT, мс | CLS | Speed Index, мс | Вага сторінки, КБ |
| ------: | ------: | ------: | --: | --------------: | ----------------: |
|    2554 |    2554 |       0 |   0 |            2554 |               324 |

CLS ×1000. Проблеми (аудити з оцінкою < 0,9, останній прогін):

- `unused-javascript` — Reduce unused JavaScript (Est savings of 194 KiB)
- `network-dependency-tree-insight` — Network dependency tree
- `render-blocking-insight` — Render-blocking requests (Est savings of 150 ms)
- `first-contentful-paint` — First Contentful Paint (2.6 s)
- `largest-contentful-paint` — Largest Contentful Paint (2.6 s)
