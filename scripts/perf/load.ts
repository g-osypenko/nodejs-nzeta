/**
 * `make load` — load test of spec.md §9 on the perf stand (perf/compose.yml).
 *
 *   npx tsx scripts/perf/load.ts --label=baseline
 *   npx tsx scripts/perf/load.ts --label=after --scenarios=handshake:200 --repeats=3
 *   npx tsx scripts/perf/load.ts --label=sweep --sweep="handshake:100,200,400,800;login:5,10,20,40" --repeats=1
 *
 * Per measurement: warm-up run (discarded) → /debug/runtime snapshot → measured k6 run →
 * snapshot. Server numbers are deltas between the snapshots over k6's own test duration.
 * Output: reports/perf/<label>.json (raw) + docs/perf/load-<label>.md (tables).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeSnapshot } from '../../src/shared/runtime-metrics.js';
import {
  ADMIN,
  ROOT,
  SEED_PASSWORD,
  buildImage,
  codeVersion,
  getJson,
  log,
  login,
  prepareData,
  runK6,
  startApp,
  type K6Summary,
} from './stand.js';

interface Options {
  label: string;
  points: { scenario: string; rate: number; loginRate?: number }[];
  repeats: number;
  duration: string;
  warmup: string;
  build: boolean;
  sweep: boolean;
}

const DEFAULT_SCENARIOS =
  'handshake:200,cabinet:100,login:20,plans:200,admin:20,mixed:200,storm:400+60';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parseOptions(): Options {
  const sweep = arg('sweep');
  const points = sweep
    ? sweep.split(';').flatMap((part) => {
        const [scenario = '', rates = ''] = part.split(':');
        return rates.split(',').map((r) => ({ scenario, rate: Number(r) }));
      })
    : (arg('scenarios') ?? DEFAULT_SCENARIOS).split(',').map((p) => {
        // storm:400+60 → 400 handshakes/s plus 60 logins/s at the same time
        const [scenario = '', rate = ''] = p.split(':');
        const [main = '', login] = rate.split('+');
        return login === undefined
          ? { scenario, rate: Number(main) }
          : { scenario, rate: Number(main), loginRate: Number(login) };
      });
  return {
    label: arg('label') ?? 'run',
    points,
    repeats: Number(arg('repeats') ?? (sweep ? 1 : 5)),
    duration: arg('duration') ?? '30s',
    warmup: arg('warmup') ?? '10s',
    build: !process.argv.includes('--no-build'),
    sweep: sweep !== undefined,
  };
}

interface Measurement {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  failedRate: number;
  dropped: number;
  requests: number;
  cpuPct: number; // CPU time of the process / test wall time (100 % = one full core)
  eluPct: number; // main-thread busy time / test wall time
  loopDelayP99: number;
  rssMb: number;
  byName: Record<string, { p50: number; p95: number; p99: number; count: number }>;
}

function metric(s: K6Summary, name: string, value: string): number {
  return s.metrics[name]?.values[value] ?? 0;
}

function seconds(d: string): number {
  const m = /^(\d+)(ms|s|m)$/.exec(d);
  if (!m) throw new Error(`bad duration ${d}`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : n;
}

/**
 * Rates use the configured load duration, not k6 testRunDurationMs (that one also covers setup,
 * teardown and gracefulStop and made every rate look ~10 % low). CPU and ELU deltas between the
 * snapshots include the idle k6 start-up, which adds ~0 server work.
 */
function toMeasurement(
  s: K6Summary,
  a: RuntimeSnapshot,
  b: RuntimeSnapshot,
  durationSec: number,
): Measurement {
  const wall = durationSec * 1000;
  const byName: Measurement['byName'] = {};
  for (const [key, m] of Object.entries(s.metrics)) {
    const name = /^http_req_duration\{name:(.+)\}$/.exec(key)?.[1];
    const v = m?.values;
    if (name && v && (v['count'] ?? 0) > 0) {
      byName[name] = {
        p50: v['med'] ?? 0,
        p95: v['p(95)'] ?? 0,
        p99: v['p(99)'] ?? 0,
        count: v['count'] ?? 0,
      };
    }
  }
  const cpu = b.cpuUserMs + b.cpuSystemMs - (a.cpuUserMs + a.cpuSystemMs);
  return {
    rps: metric(s, 'http_reqs', 'count') / durationSec,
    p50: metric(s, 'http_req_duration', 'med'),
    p95: metric(s, 'http_req_duration', 'p(95)'),
    p99: metric(s, 'http_req_duration', 'p(99)'),
    max: metric(s, 'http_req_duration', 'max'),
    failedRate: metric(s, 'http_req_failed', 'rate'),
    dropped: metric(s, 'dropped_iterations', 'count'),
    requests: metric(s, 'http_reqs', 'count'),
    cpuPct: (cpu / wall) * 100,
    eluPct: ((b.elu.activeMs - a.elu.activeMs) / wall) * 100,
    loopDelayP99: b.eventLoopDelayMs.p99,
    rssMb: b.memoryMb.rss,
    byName,
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

function stat(xs: number[], digits = 1): string {
  const f = (n: number): string => n.toFixed(digits);
  if (xs.length === 1) return f(xs[0] ?? 0);
  return `${f(median(xs))} (${f(Math.min(...xs))}–${f(Math.max(...xs))})`;
}

async function main(): Promise<void> {
  const o = parseOptions();
  const version = codeVersion();
  if (o.build) buildImage(version);
  prepareData();
  startApp();
  const served = await getJson<{ commit: string }>('/version');
  log(`app up, /version → ${served.commit}`);

  const tokens = await Promise.all(
    Array.from({ length: 50 }, (_, i) => login(`seed-${i + 1}@lch.local`, SEED_PASSWORD)),
  );
  const adminToken = await login(ADMIN.email, ADMIN.password);
  const env = { TOKENS_LIST: tokens.join(','), ADMIN_TOKEN: adminToken };

  const results: { scenario: string; rate: number; loginRate?: number; runs: Measurement[] }[] = [];
  for (const p of o.points) {
    log(`${p.scenario} @ ${p.rate} rps: warm-up ${o.warmup}`);
    const pEnv = p.loginRate === undefined ? env : { ...env, LOGIN_RATE: String(p.loginRate) };
    runK6({ ...p, duration: o.warmup, env: pEnv }, `warmup-${p.scenario}`);
    const runs: Measurement[] = [];
    for (let i = 1; i <= o.repeats; i += 1) {
      const a = await getJson<RuntimeSnapshot>('/debug/runtime?reset=1');
      const s = runK6(
        { ...p, duration: o.duration, env: pEnv },
        `${o.label}-${p.scenario}-${p.rate}-${i}`,
      );
      const b = await getJson<RuntimeSnapshot>('/debug/runtime');
      const m = toMeasurement(s, a, b, seconds(o.duration));
      runs.push(m);
      log(
        `  #${i}: ${m.rps.toFixed(0)} rps, p50 ${m.p50.toFixed(1)} / p95 ${m.p95.toFixed(1)} / p99 ${m.p99.toFixed(1)} ms, ` +
          `cpu ${m.cpuPct.toFixed(0)} %, elu ${m.eluPct.toFixed(0)} %, dropped ${m.dropped}, failed ${(m.failedRate * 100).toFixed(2)} %`,
      );
    }
    results.push({ ...p, runs });
  }

  const reportDir = join(ROOT, 'reports', 'perf');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, `${o.label}.json`),
    JSON.stringify({ version: served.commit, options: o, results }, null, 2),
  );

  const col =
    (f: (m: Measurement) => number, d = 1) =>
    (r: (typeof results)[number]): string =>
      stat(r.runs.map(f), d);
  const rows = results.map((r) =>
    [
      `\`${r.scenario}\``,
      r.loginRate === undefined ? String(r.rate) : `${r.rate} + ${r.loginRate} login`,
      col((m) => m.rps, 0)(r),
      col((m) => m.p50)(r),
      col((m) => m.p95)(r),
      col((m) => m.p99)(r),
      col((m) => m.failedRate * 100, 2)(r),
      col((m) => m.dropped, 0)(r),
      col((m) => m.cpuPct, 0)(r),
      col((m) => m.eluPct, 0)(r),
      col((m) => m.loopDelayP99)(r),
      col((m) => m.rssMb, 0)(r),
    ].join(' | '),
  );
  // Per request type: does one module slow down another in a mixed load?
  const typeRows = results.flatMap((r) => {
    const names = [...new Set(r.runs.flatMap((m) => Object.keys(m.byName)))];
    if (names.length < 2) return [];
    return names.map((n) => {
      const pick = (k: 'p50' | 'p95' | 'p99'): string =>
        stat(r.runs.map((m) => m.byName[n]?.[k] ?? NaN));
      const cells = [`\`${r.scenario}\``, n, pick('p50'), pick('p95'), pick('p99')];
      return `| ${cells.join(' | ')} |`;
    });
  });
  const md = [
    `# Навантаження: ${o.label}`,
    '',
    `- Версія (\`GET /version\`): \`${served.commit}\``,
    `- Дата: ${new Date().toISOString()}`,
    `- Стенд: застосунок 1 vCPU / 512 МБ, Postgres 17 2 vCPU, ${DATA_LINE}`,
    `- Метод: k6 constant-arrival-rate, прогрів ${o.warmup}, вимір ${o.duration}, повторів: ${o.repeats}${o.repeats > 1 ? ' — медіана (min–max)' : ''}`,
    `- Відтворити: \`npx tsx scripts/perf/load.ts ${process.argv.slice(2).join(' ')}\``,
    '',
    '| Сценарій | Ціль RPS | RPS | p50, мс | p95, мс | p99, мс | Помилки, % | Dropped | CPU, % ядра | ELU, % | Затримка EL p99, мс | RSS, МБ |',
    '| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
    ...rows.map((r) => `| ${r} |`),
    '',
    ...(typeRows.length === 0
      ? []
      : [
          'За типом запиту (змішані сценарії):',
          '',
          '| Сценарій | Запит | p50, мс | p95, мс | p99, мс |',
          '| :-- | :-- | --: | --: | --: |',
          ...typeRows,
          '',
        ]),
    '`Dropped` — прибуття, які k6 не зміг обслужити (усі VU зайняті): ознака насичення. CPU > ELU — роботу виконують потоки libuv (scrypt) або GC; високий p99 за низьких CPU й ELU — очікування (БД, пул з’єднань, черга threadpool).',
    '',
  ].join('\n');
  const docs = join(ROOT, 'docs', 'perf');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, `load-${o.label}.md`), md);
  log(`report → docs/perf/load-${o.label}.md`);
}

const DATA_LINE = '2 000 користувачів, 200 000 ліцензій (`db:seed`)';

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
