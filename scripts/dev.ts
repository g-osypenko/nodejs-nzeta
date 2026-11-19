/**
 * `npm run local` — the whole product on localhost with one command, for day-to-day development:
 *   1. Postgres in docker compose (port 55432) + pending migrations;
 *   2. the API with auto-reload (tsx watch) on :3000;
 *   3. the site with hot reload (Vite) on :5173, which proxies /api to the API.
 * Logs are printed readably, and every sign-in email (MAILER=console) is shown as a box with the
 * code and the link. Ctrl+C stops everything (the database keeps running: `npm run db:down`).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SITE = 'http://localhost:5173';
const API = 'http://127.0.0.1:3000';

const color = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
  green: (s: string): string => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string): string => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string): string => `\x1b[35m${s}\x1b[0m`,
};

function say(msg: string): void {
  process.stdout.write(`${color.bold('[local]')} ${msg}\n`);
}

/** Runs a step to completion with its output visible; stops the script if it fails. */
function step(title: string, cmd: string, args: string[]): void {
  say(title);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    say(color.red(`не вдалося: ${title}. Чи запущений Docker Desktop?`));
    process.exit(1);
  }
}

const HIDDEN = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'reqId', 'processId']);
const LEVELS: Record<number, (s: string) => string> = {
  20: (s) => color.dim(s),
  30: (s) => s,
  40: (s) => color.yellow(s),
  50: (s) => color.red(s),
  60: (s) => color.red(color.bold(s)),
};

function mailBox(line: Record<string, unknown>): string {
  const rows = [
    `📬 Лист для ${String(line['mailTo'])}`,
    `   код:       ${color.bold(String(line['code']))}`,
    `   посилання: ${String(line['link'])}`,
  ];
  const bar = color.magenta('─'.repeat(72));
  return `${bar}\n${rows.join('\n')}\n${bar}`;
}

/** One pino JSON line → one readable line (or the mail box for a sign-in email). */
function pretty(raw: string): string {
  let line: Record<string, unknown>;
  try {
    line = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (typeof line['code'] === 'string' && typeof line['mailTo'] === 'string') return mailBox(line);
  const time = new Date(Number(line['time'])).toLocaleTimeString('uk-UA');
  const paint = LEVELS[Number(line['level'])] ?? ((s: string): string => s);
  if (line['msg'] === 'request completed') {
    const status = Number(line['statusCode']);
    const statusText = status >= 500 ? color.red : status >= 400 ? color.yellow : color.green;
    return `${color.dim(time)} ${String(line['method'])} ${String(line['route'])} → ${statusText(
      String(status),
    )} ${color.dim(`${String(line['durationMs'])} мс, SQL: ${String(line['dbQueries'])}`)}`;
  }
  const extra = Object.entries(line)
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${color.dim(time)} ${paint(String(line['msg']))}${extra ? ` ${color.dim(extra)}` : ''}`;
}

function pipe(child: ChildProcess, label: string, transform: (s: string) => string): void {
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const l of lines) {
        if (l.trim() !== '') process.stdout.write(`${label} ${transform(l.trimEnd())}\n`);
      }
    });
  }
}

function main(): void {
  step('Postgres (docker compose, порт 55432)…', 'docker', ['compose', 'up', '-d', '--wait', 'db']);
  step('міграції…', process.execPath, [
    join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
    'src/shared/db/migrate.ts',
  ]);

  // Development settings win over .env: dotenv never overrides variables that are already set.
  const api = spawn(
    process.execPath,
    [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'watch', '--conditions=source', 'src/index.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_SOURCE: 'postgres',
        MAILER: 'console',
        COOKIE_SECURE: 'false',
        APP_BASE_URL: SITE,
        DEBUG_HEADERS: 'true',
        LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  pipe(api, color.cyan('[api]'), pretty);

  const web = spawn(process.execPath, [join(ROOT, 'web/node_modules/vite/bin/vite.js')], {
    cwd: join(ROOT, 'web'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe(web, color.green('[web]'), (s) => s);

  say(`сайт:   ${color.bold(SITE)}   (вхід — код із листа, лист з'явиться тут, у терміналі)`);
  say(`API:    ${API}   ·   БД: postgres://lch:lch_dev_password@127.0.0.1:55432/lch_lab2`);
  say(
    color.dim(
      'Ctrl+C — зупинити. Оплатити замовлення без провайдера: npm run dev:pay -- <orderId>',
    ),
  );

  const stop = (): void => {
    api.kill();
    web.kill();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let alive = 2;
  for (const [child, name] of [
    [api, 'API'],
    [web, 'сайт'],
  ] as const) {
    child.once('exit', (code) => {
      alive -= 1;
      if (code !== 0 && code !== null) say(color.red(`${name} зупинився з кодом ${code}`));
      if (alive === 0) process.exit(0);
      stop();
    });
  }
}

main();
