/**
 * Load-test stand helpers (perf/compose.yml): image of the current commit, seeded Postgres,
 * the app with DEBUG_RUNTIME, k6 runs. Shared by load.ts, profile.ts and explain.ts.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = process.cwd();
export const COMPOSE = ['compose', '-f', join(ROOT, 'perf', 'compose.yml')];
export const APP_URL = 'http://127.0.0.1:3900';
export const OUT_DIR = join(ROOT, 'perf', 'out');
export const DATA = { users: 2000, licenses: 200_000 };
export const ADMIN_EMAIL = 'admin@lch.local';

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

export async function startApp(nodeOptions = ''): Promise<void> {
  compose(['up', '-d', '--wait', '--force-recreate', 'app'], { APP_NODE_OPTIONS: nodeOptions });
  // "healthy" is checked inside the container; the host port mapping may lag behind a recreate.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${APP_URL}/version`);
      if (res.ok) return;
    } catch {
      // connection refused / reset while the port proxy comes up
    }
    if (Date.now() > deadline) throw new Error(`app did not answer on ${APP_URL} within 30 s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function stopApp(): void {
  compose(['stop', '-t', '20', 'app']); // SIGTERM → graceful shutdown (writes --cpu-prof files)
}

export async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${APP_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const PERF_EMAIL = /^[a-z0-9-]+@lch\.local$/;

/**
 * Ready sessions for the load scenarios, created straight in the stand's database (ADR 0011).
 * Sign-in is by an emailed code, which a load script cannot read, and the set-up is not what is
 * measured anyway. Only the SHA-256 of each token is stored, exactly as the app does.
 * The values are fixed stand emails and hex digests (checked below), never user input.
 */
export function sessionsFor(emails: readonly string[]): string[] {
  const tokens = emails.map(() => randomBytes(32).toString('base64url'));
  const rows = emails.map((email, i) => {
    if (!PERF_EMAIL.test(email)) throw new Error(`not a stand email: ${email}`);
    const digest = createHash('sha256')
      .update(tokens[i] ?? '')
      .digest('hex');
    return `('${digest}', '${email}')`;
  });
  const sql =
    'INSERT INTO sessions (token_hash, user_id, expires_at) ' +
    `SELECT v.h, u.id, now() + interval '1 day' FROM (VALUES ${rows.join(', ')}) AS v(h, email) ` +
    'JOIN users u ON u.email = v.email';
  const out = run('docker', [
    ...COMPOSE,
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'lch',
    '-d',
    'lch_perf',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
  if (out !== `INSERT 0 ${emails.length}`) throw new Error(`sessions not created: ${out}`);
  return tokens;
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
