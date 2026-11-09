/**
 * `make profile` — V8 CPU profile of the app under one load scenario (spec §9.3).
 *
 * The app container is restarted with `node --cpu-prof`; k6 drives the scenario; SIGTERM makes the
 * process exit gracefully and V8 writes the .cpuprofile (open it in Chrome DevTools → Performance).
 * The script also aggregates self time by function and by layer: our code, dependencies,
 * Node internals, GC, idle — so "where does the CPU go" is answered with numbers.
 *
 *   npx tsx scripts/perf/profile.ts --scenarios=handshake:400,login:20 [--label=baseline] [--no-build]
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OUT_DIR,
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
  stopApp,
} from './stand.js';

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}
interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

function layerOf(url: string, fn: string): string {
  if (fn === '(garbage collector)') return 'GC';
  if (fn === '(idle)') return 'idle (очікування подій)';
  if (fn === '(program)' || fn === '(root)') return 'V8/native (program)';
  if (url.includes('/app/dist/')) return 'наш код (dist/)';
  if (url.includes('node_modules/')) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(url);
    return `залежність: ${m?.[1] ?? '?'}`;
  }
  if (url.startsWith('node:') || url === '') return 'Node.js (вбудовані модулі, native)';
  return 'інше';
}

function shortUrl(url: string): string {
  return url.replace(/^file:\/\/\/app\//, '').replace(/^.*node_modules\//, '');
}

function analyse(p: CpuProfile): {
  total: number;
  layers: [string, number][];
  top: [string, number][];
} {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  // Sample COUNTS, not timeDeltas: under the container CPU quota the sampler thread is starved
  // too, and a gap of up to ~90 ms was attributed to the next sample (mostly "(idle)").
  p.samples.forEach((id) => self.set(id, (self.get(id) ?? 0) + 1));
  const layers = new Map<string, number>();
  const fns = new Map<string, number>();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id);
    if (!n) continue;
    const { functionName, url, lineNumber } = n.callFrame;
    if (functionName === '(idle)') continue; // shares are of BUSY main-thread time
    total += us;
    const layer = layerOf(url, functionName);
    layers.set(layer, (layers.get(layer) ?? 0) + us);
    if (!functionName.startsWith('(')) {
      const key = `${functionName || '(anonymous)'} — ${shortUrl(url)}:${lineNumber + 1}`;
      fns.set(key, (fns.get(key) ?? 0) + us);
    }
  }
  const sort = (m: Map<string, number>): [string, number][] => [...m].sort((a, b) => b[1] - a[1]);
  return { total, layers: sort(layers), top: sort(fns).slice(0, 15) };
}

async function main(): Promise<void> {
  const argv = (n: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const label = argv('label') ?? 'baseline';
  const points = (argv('scenarios') ?? 'handshake:400,login:20').split(',').map((s) => {
    const [scenario = '', rate = ''] = s.split(':');
    return { scenario, rate: Number(rate) };
  });
  const duration = argv('duration') ?? '30s';
  if (!process.argv.includes('--no-build')) buildImage(codeVersion());
  prepareData();

  const profDir = join(OUT_DIR, 'profiles');
  const sections: string[] = [];
  let version = '?';
  for (const p of points) {
    rmSync(profDir, { recursive: true, force: true });
    mkdirSync(profDir, { recursive: true });
    // 250 µs: with the default 1 ms the profile of a 0.5 ms request had almost no busy samples.
    await startApp('--cpu-prof --cpu-prof-dir=/profiles --cpu-prof-interval=250');
    version = (await getJson<{ commit: string }>('/version')).commit;
    const tokens = await Promise.all(
      Array.from({ length: 50 }, (_, i) => login(`seed-${i + 1}@lch.local`, SEED_PASSWORD)),
    );
    log(`profiling ${p.scenario} @ ${p.rate} rps for ${duration}`);
    runK6({ ...p, duration, env: { TOKENS_LIST: tokens.join(',') } }, `profile-${p.scenario}`);
    stopApp();
    const file = readdirSync(profDir).find((f) => f.endsWith('.cpuprofile'));
    if (!file) throw new Error('no .cpuprofile written (did the app exit gracefully?)');
    const keep = join(ROOT, 'reports', 'perf', `profile-${label}-${p.scenario}.cpuprofile`);
    mkdirSync(join(ROOT, 'reports', 'perf'), { recursive: true });
    const raw = readFileSync(join(profDir, file), 'utf8');
    writeFileSync(keep, raw);
    const a = analyse(JSON.parse(raw) as CpuProfile);
    const pct = (us: number): string => ((us / a.total) * 100).toFixed(1);
    sections.push(
      [
        `## \`${p.scenario}\` @ ${p.rate} RPS, ${duration}`,
        '',
        `Профіль: \`reports/perf/profile-${label}-${p.scenario}.cpuprofile\` (Chrome DevTools → Performance → Load profile). ` +
          `Зайнятих семплів main thread: **${a.total}**; частки нижче — від зайнятого часу (idle виключено).`,
        '',
        '| Шар | Частка зайнятого main thread, % |',
        '| :-- | --: |',
        ...a.layers.map(([l, us]) => `| ${l} | ${pct(us)} |`),
        '',
        '| Топ функцій за self time | % |',
        '| :-- | --: |',
        ...a.top.map(([f, us]) => `| \`${f.replace(/\|/g, '\\|')}\` | ${pct(us)} |`),
        '',
      ].join('\n'),
    );
  }
  await startApp(); // leave the stand in its normal state
  const md = [
    `# CPU-профіль: ${label}`,
    '',
    `- Версія (\`/version\`): \`${version}\` · ${new Date().toISOString()}`,
    '- Інструмент: вбудований V8 `--cpu-prof` (без залежностей), стенд як у `make load` (1 vCPU)',
    `- Відтворити: \`npx tsx scripts/perf/profile.ts ${process.argv.slice(2).join(' ')}\``,
    '- **Профіль дає пропорції, а не абсолютну вартість:** семплування 250 мкс саме навантажує 1 vCPU (контрольний прогін handshake 800 RPS: ELU 76 % під профайлером проти 30 % без нього). Абсолютні CPU/ELU/латентність — у `load-*.md`.',
    '- Профіль бачить лише main thread: робота в потоках libuv (scrypt, частина I/O) тут не видна — її показує CPU процесу проти ELU у `load-*.md`.',
    '',
    ...sections,
  ].join('\n');
  writeFileSync(join(ROOT, 'docs', 'perf', `profile-${label}.md`), md);
  log(`report → docs/perf/profile-${label}.md`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
