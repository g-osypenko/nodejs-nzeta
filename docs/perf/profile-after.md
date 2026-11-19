# CPU-профіль: after

- Версія (`/version`): `51efdf294639f907736ef3018d7d26f74a63cb1b` · 2026-11-09T12:08:00.987Z
- Інструмент: вбудований V8 `--cpu-prof` (без залежностей), стенд як у `make load` (1 vCPU)
- Відтворити: `npx tsx scripts/perf/profile.ts --label=after --no-build --scenarios=storm:400`
- **Профіль дає пропорції, а не абсолютну вартість:** семплування 250 мкс саме навантажує 1 vCPU (контрольний прогін handshake 800 RPS: ELU 76 % під профайлером проти 30 % без нього). Абсолютні CPU/ELU/латентність — у `load-*.md`.
- Профіль бачить лише main thread: робота в потоках libuv (scrypt, частина I/O) тут не видна — її показує CPU процесу проти ELU у `load-*.md`.

## `storm` @ 400 RPS, 30s

Профіль: `reports/perf/profile-after-storm.cpuprofile` (Chrome DevTools → Performance → Load profile). Зайнятих семплів main thread: **16784**; частки нижче — від зайнятого часу (idle виключено).

| Шар                                | Частка зайнятого main thread, % |
| :--------------------------------- | ------------------------------: |
| Node.js (вбудовані модулі, native) |                            53.3 |
| залежність: postgres               |                            14.1 |
| V8/native (program)                |                             9.9 |
| залежність: fastify                |                             6.2 |
| GC                                 |                             5.3 |
| наш код (dist/)                    |                             4.7 |
| залежність: pino                   |                             2.1 |
| залежність: zod                    |                             0.9 |
| залежність: find-my-way            |                             0.8 |
| залежність: secure-json-parse      |                             0.7 |
| інше                               |                             0.5 |
| залежність: sonic-boom             |                             0.5 |
| залежність: @fastify/cors          |                             0.4 |
| залежність: @fastify/static        |                             0.2 |
| залежність: pino-std-serializers   |                             0.1 |
| залежність: semver                 |                             0.1 |
| залежність: toad-cache             |                             0.1 |
| залежність: avvio                  |                             0.1 |
| залежність: ajv                    |                             0.0 |
| залежність: ret                    |                             0.0 |
| залежність: mime                   |                             0.0 |
| залежність: dotenv                 |                             0.0 |
| залежність: fastq                  |                             0.0 |
| залежність: quick-format-unescaped |                             0.0 |
| залежність: @fastify/error         |                             0.0 |
| залежність: rfdc                   |                             0.0 |
| залежність: ipaddr.js              |                             0.0 |
| залежність: fast-querystring       |                             0.0 |
| залежність: safe-stable-stringify  |                             0.0 |
| залежність: on-exit-leak-free      |                             0.0 |
| залежність: statuses               |                             0.0 |
| залежність: toidentifier           |                             0.0 |
| залежність: http-errors            |                             0.0 |
| залежність: fast-uri               |                             0.0 |
| залежність: ajv-formats            |                             0.0 |

| Топ функцій за self time                                |    % |
| :------------------------------------------------------ | ---: |
| `writev — :0`                                           | 11.7 |
| `writeBuffer — :0`                                      |  8.9 |
| `Query — postgres/src/query.js:7`                       |  6.4 |
| `writeString — :0`                                      |  4.1 |
| `Result — postgres/src/result.js:2`                     |  1.8 |
| `AppError — dist/shared/errors.js:25`                   |  1.3 |
| `runMicrotasks — :0`                                    |  1.1 |
| `(anonymous) — :0`                                      |  0.9 |
| `parserOnHeadersComplete — node:_http_common:77`        |  0.8 |
| `wrapSafe — node:internal/modules/cjs/loader:1671`      |  0.8 |
| `build — postgres/src/connection.js:224`                |  0.7 |
| `emit — node:events:466`                                |  0.7 |
| `writevGeneric — node:internal/stream_base_commons:121` |  0.7 |
| `callbackTrampoline — node:internal/async_hooks:118`    |  0.7 |
| `_parse — secure-json-parse/index.js:17`                |  0.7 |
