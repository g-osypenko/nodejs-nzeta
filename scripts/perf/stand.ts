/**
 * Load-test stand helpers (perf/compose.yml): image of the current commit, seeded Postgres,
 * the app with DEBUG_RUNTIME, k6 runs. Shared by load.ts, profile.ts and explain.ts.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.cwd();
export const COMPOSE = ['compose', '-f', join(ROOT, 'perf', 'compose.yml')];
export const APP_URL = 'http://127.0.0.1:3900';
export const OUT_DIR = join(ROOT, 'perf', 'out');
export const DATA = { users: 2000, licenses: 200_000 };
export const SEED_PASSWORD = 'seed-password-01';
export const ADMIN = { email: 'admin@lch.local', password: 'perf-admin-password' };

export function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): string {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${res.status}\n${String(res.stderr)}`);
  }
  return String(res.stdout ?? '').trim();
}

export function log(msg: string): void {
  process.stdout.write(`[perf] ${msg}\n`);
}

/** SHA of the code under test; "-dirty" when the working tree has uncommitted changes. */
export function codeVersion(): string {
  const sha = run('git', ['rev-parse', 'HEAD']);
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']) !== '';
  return dirty ? `${sha}-dirty` : sha;
}

export function buildImage(version: string): void {
  log(`docker build nodejs-nzeta:perf (GIT_COMMIT=${version})`);
  run('docker', [
    'build',
    '-q',
    '--build-arg',
    `GIT_COMMIT=${version}`,
    '-t',
    'nodejs-nzeta:perf',
    ROOT,
  ]);
}

export function compose(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return run('docker', [...COMPOSE, ...args], { env: { ...process.env, ...env } });
}

/** Migrations + deterministic seed (idempotent: re-running inserts nothing). */
export function prepareData(): void {
  log('db up, migrations, seed');
  compose(['up', '-d', '--wait', 'db']);
  compose(['run', '--rm', '--no-deps', 'app', 'node', 'dist/shared/db/migrate.js']);
  const out = compose([
    'run',
    '--rm',
    '--no-deps',
    'app',
    'node',
    'dist/seed.js',
    `--users=${DATA.users}`,
    `--licenses=${DATA.licenses}`,
  ]);
  log(out);
}

export function startApp(nodeOptions = ''): void {
  compose(['up', '-d', '--wait', '--force-recreate', 'app'], { APP_NODE_OPTIONS: nodeOptions });
}

export function stopApp(): void {
  compose(['stop', '-t', '20', 'app']); // SIGTERM → graceful shutdown (writes --cpu-prof files)
}

export async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${APP_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<string> {
  const { token } = await getJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return token;
}

export interface K6Run {
  scenario: string;
  rate: number;
  duration: string;
  env?: Record<string, string>;
}

export interface K6Summary {
  state: { testRunDurationMs: number };
  metrics: Record<string, { values: Record<string, number> } | undefined>;
}

export function runK6(r: K6Run, outName: string): K6Summary {
  mkdirSync(OUT_DIR, { recursive: true });
  const envArgs = Object.entries({
    SCENARIO: r.scenario,
    RATE: String(r.rate),
    DURATION: r.duration,
    OUT: `/out/${outName}.json`,
    LICENSES: String(DATA.licenses),
    USERS: String(DATA.users),
    ...r.env,
  }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  compose(['run', '--rm', 'k6', 'run', '-q', '--no-color', ...envArgs, '/scripts/load.js']);
  return JSON.parse(readFileSync(join(OUT_DIR, `${outName}.json`), 'utf8')) as K6Summary;
}
