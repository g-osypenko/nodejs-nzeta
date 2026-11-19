# CPU-профіль: baseline

- Версія (`/version`): `27b5c460cef8d429612ab3ac30c002cae61e58d8` · 2026-11-09T11:33:29.988Z
- Інструмент: вбудований V8 `--cpu-prof` (без залежностей), стенд як у `make load` (1 vCPU)
- Відтворити: `npx tsx scripts/perf/profile.ts --label=baseline --no-build --scenarios=handshake:800,login:30,storm:400`
- **Профіль дає пропорції, а не абсолютну вартість:** семплування 250 мкс саме навантажує 1 vCPU (контрольний прогін handshake 800 RPS: ELU 76 % під профайлером проти 30 % без нього). Абсолютні CPU/ELU/латентність — у `load-*.md`.
- Профіль бачить лише main thread: робота в потоках libuv (scrypt, частина I/O) тут не видна — її показує CPU процесу проти ELU у `load-*.md`.

## `handshake` @ 800 RPS, 30s

Профіль: `reports/perf/profile-baseline-handshake.cpuprofile` (Chrome DevTools → Performance → Load profile). Зайнятих семплів main thread: **30296**; частки нижче — від зайнятого часу (idle виключено).

| Шар                                | Частка зайнятого main thread, % |
| :--------------------------------- | ------------------------------: |
| Node.js (вбудовані модулі, native) |                            53.7 |
| залежність: postgres               |                            14.5 |
| V8/native (program)                |                            10.8 |
| залежність: fastify                |                             6.1 |
| GC                                 |                             4.5 |
| наш код (dist/)                    |                             4.5 |
| залежність: pino                   |                             2.0 |
| залежність: find-my-way            |                             0.9 |
| залежність: secure-json-parse      |                             0.9 |
| залежність: zod                    |                             0.8 |
| залежність: sonic-boom             |                             0.5 |
| залежність: @fastify/cors          |                             0.4 |
| залежність: toad-cache             |                             0.2 |
| залежність: @fastify/static        |                             0.1 |
| залежність: avvio                  |                             0.0 |
| залежність: semver                 |                             0.0 |
| залежність: ajv                    |                             0.0 |
| залежність: quick-format-unescaped |                             0.0 |
| залежність: ret                    |                             0.0 |
| залежність: fastq                  |                             0.0 |
| залежність: @fastify/error         |                             0.0 |
| залежність: safe-regex2            |                             0.0 |
| залежність: mime                   |                             0.0 |
| залежність: http-errors            |                             0.0 |
| залежність: fastify-plugin         |                             0.0 |
| залежність: depd                   |                             0.0 |
| залежність: statuses               |                             0.0 |
| залежність: rfdc                   |                             0.0 |
| залежність: fast-uri               |                             0.0 |
| залежність: ajv-formats            |                             0.0 |

| Топ функцій за self time                                |    % |
| :------------------------------------------------------ | ---: |
| `writev — :0`                                           | 11.9 |
| `writeBuffer — :0`                                      | 10.2 |
| `Query — postgres/src/query.js:7`                       |  6.5 |
| `writeString — :0`                                      |  5.6 |
| `Result — postgres/src/result.js:2`                     |  1.9 |
| `runMicrotasks — :0`                                    |  1.3 |
| `AppError — dist/shared/errors.js:24`                   |  1.1 |
| `(anonymous) — :0`                                      |  1.1 |
| `emit — node:events:466`                                |  0.9 |
| `_parse — secure-json-parse/index.js:17`                |  0.8 |
| `parserOnHeadersComplete — node:_http_common:77`        |  0.8 |
| `build — postgres/src/connection.js:224`                |  0.7 |
| `parse — postgres/src/types.js:32`                      |  0.7 |
| `parserOnIncoming — node:_http_server:1073`             |  0.6 |
| `(anonymous) — dist/modules/loader/loader.routes.js:13` |  0.6 |

## `login` @ 30 RPS, 30s

Профіль: `reports/perf/profile-baseline-login.cpuprofile` (Chrome DevTools → Performance → Load profile). Зайнятих семплів main thread: **3948**; частки нижче — від зайнятого часу (idle виключено).

| Шар                                     | Частка зайнятого main thread, % |
| :-------------------------------------- | ------------------------------: |
| Node.js (вбудовані модулі, native)      |                            59.0 |
| залежність: postgres                    |                            10.1 |
| V8/native (program)                     |                             8.1 |
| залежність: fastify                     |                             5.5 |
| GC                                      |                             5.4 |
| наш код (dist/)                         |                             3.2 |
| залежність: zod                         |                             2.1 |
| залежність: pino                        |                             1.7 |
| залежність: find-my-way                 |                             1.4 |
| залежність: @fastify/static             |                             0.7 |
| залежність: secure-json-parse           |                             0.6 |
| залежність: sonic-boom                  |                             0.6 |
| залежність: @fastify/cors               |                             0.5 |
| залежність: avvio                       |                             0.3 |
| залежність: semver                      |                             0.2 |
| залежність: ajv                         |                             0.2 |
| залежність: ret                         |                             0.1 |
| залежність: toad-cache                  |                             0.1 |
| залежність: mime                        |                             0.1 |
| залежність: http-errors                 |                             0.1 |
| залежність: safe-regex2                 |                             0.1 |
| залежність: dotenv                      |                             0.1 |
| залежність: fastq                       |                             0.1 |
| залежність: fastify-plugin              |                             0.0 |
| залежність: @fastify/error              |                             0.0 |
| залежність: ipaddr.js                   |                             0.0 |
| залежність: safe-stable-stringify       |                             0.0 |
| залежність: toidentifier                |                             0.0 |
| залежність: @fastify/merge-json-schemas |                             0.0 |

| Топ функцій за self time                                        |   % |
| :-------------------------------------------------------------- | --: |
| `writeBuffer — :0`                                              | 6.6 |
| `wrapSafe — node:internal/modules/cjs/loader:1671`              | 3.3 |
| `writeString — :0`                                              | 3.2 |
| `writev — :0`                                                   | 3.1 |
| `scrypt — node:internal/crypto/scrypt:40`                       | 2.0 |
| `Query — postgres/src/query.js:7`                               | 2.0 |
| `compileSourceTextModule — node:internal/modules/esm/utils:344` | 1.8 |
| `internalModuleStat — :0`                                       | 1.7 |
| `Result — postgres/src/result.js:2`                             | 1.4 |
| `callbackTrampoline — node:internal/async_hooks:118`            | 1.2 |
| `nextTick — node:internal/process/task_queues:111`              | 1.0 |
| `randomFillSync — node:internal/crypto/random:127`              | 1.0 |
| `emit — node:events:466`                                        | 0.9 |
| `build — postgres/src/connection.js:224`                        | 0.9 |
| `runMicrotasks — :0`                                            | 0.8 |

## `storm` @ 400 RPS, 30s

Профіль: `reports/perf/profile-baseline-storm.cpuprofile` (Chrome DevTools → Performance → Load profile). Зайнятих семплів main thread: **10771**; частки нижче — від зайнятого часу (idle виключено).

| Шар                                | Частка зайнятого main thread, % |
| :--------------------------------- | ------------------------------: |
| Node.js (вбудовані модулі, native) |                            46.5 |
| залежність: postgres               |                            14.6 |
| GC                                 |                            11.9 |
| V8/native (program)                |                             9.6 |
| залежність: fastify                |                             5.8 |
| наш код (dist/)                    |                             4.9 |
| залежність: pino                   |                             2.1 |
| залежність: secure-json-parse      |                             1.5 |
| залежність: zod                    |                             1.1 |
| залежність: find-my-way            |                             0.8 |
| залежність: @fastify/cors          |                             0.4 |
| залежність: @fastify/static        |                             0.3 |
| залежність: sonic-boom             |                             0.1 |
| залежність: avvio                  |                             0.1 |
| залежність: toad-cache             |                             0.1 |
| залежність: semver                 |                             0.1 |
| залежність: ret                    |                             0.0 |
| залежність: ajv                    |                             0.0 |
| залежність: quick-format-unescaped |                             0.0 |
| залежність: safe-regex2            |                             0.0 |
| залежність: @fastify/error         |                             0.0 |
| залежність: @fastify/proxy-addr    |                             0.0 |
| залежність: mime                   |                             0.0 |
| залежність: http-errors            |                             0.0 |
| залежність: toidentifier           |                             0.0 |
| залежність: dotenv                 |                             0.0 |
| залежність: ajv-formats            |                             0.0 |

| Топ функцій за self time                                           |    % |
| :----------------------------------------------------------------- | ---: |
| `writev — :0`                                                      | 11.0 |
| `Query — postgres/src/query.js:7`                                  |  7.6 |
| `writeBuffer — :0`                                                 |  5.8 |
| `Result — postgres/src/result.js:2`                                |  1.6 |
| `_parse — secure-json-parse/index.js:17`                           |  1.5 |
| `AppError — dist/shared/errors.js:24`                              |  1.4 |
| `wrapSafe — node:internal/modules/cjs/loader:1671`                 |  1.3 |
| `runMicrotasks — :0`                                               |  1.1 |
| `(anonymous) — :0`                                                 |  1.1 |
| `parserOnHeadersComplete — node:_http_common:77`                   |  0.9 |
| `writevGeneric — node:internal/stream_base_commons:121`            |  0.8 |
| `build — postgres/src/connection.js:224`                           |  0.7 |
| `compileSourceTextModule — node:internal/modules/esm/utils:344`    |  0.7 |
| `emit — node:events:466`                                           |  0.7 |
| `processTicksAndRejections — node:internal/process/task_queues:71` |  0.6 |
