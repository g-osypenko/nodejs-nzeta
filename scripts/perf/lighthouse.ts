/**
 * `make lighthouse` — Lighthouse (mobile preset, simulated throttling) of the frontend served by the
 * perf stand (same image as `make load`), 3 runs per page, median (spec §9.6).
 *
 *   npx tsx scripts/perf/lighthouse.ts [--label=baseline] [--runs=3]
 * Needs a local Chrome. Lighthouse is pinned and run through npx — not a project dependency.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_URL, ROOT, getJson, log } from './stand.js';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const PAGES = ['/', '/login'];

interface Audit {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
  numericValue?: number;
}
interface Lhr {
  categories: Record<string, { score: number | null }>;
  audits: Record<string, Audit>;
}

const METRICS: [string, string, number][] = [
  ['first-contentful-paint', 'FCP, мс', 1],
  ['largest-contentful-paint', 'LCP, мс', 1],
  ['total-blocking-time', 'TBT, мс', 1],
  ['cumulative-layout-shift', 'CLS', 1000],
  ['speed-index', 'Speed Index, мс', 1],
  ['total-byte-weight', 'Вага сторінки, КБ', 1 / 1024],
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};

function lighthouse(url: string, out: string): Lhr {
  // One command string (our own constant arguments): npx is a .cmd shim on Windows and needs a shell.
  const args = [
    '-y',
    LIGHTHOUSE,
    url,
    '--quiet',
    '--output=json',
    `--output-path=${out}`,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--chrome-flags=--headless=new --no-first-run',
  ];
  const cmd = ['npx', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
  const res = spawnSync(cmd, { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) throw new Error(`lighthouse ${url} failed:\n${res.stderr}`);
  return JSON.parse(readFileSync(out, 'utf8')) as Lhr;
}

async function main(): Promise<void> {
  const arg = (n: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const label = arg('label') ?? 'baseline';
  const runs = Number(arg('runs') ?? 3);
  const version = (await getJson<{ commit: string }>('/version')).commit;
  const dir = join(ROOT, 'reports', 'perf', `lighthouse-${label}`);
  mkdirSync(dir, { recursive: true });

  const sections: string[] = [];
  for (const page of PAGES) {
    const lhrs: Lhr[] = [];
    for (let i = 1; i <= runs; i += 1) {
      log(`lighthouse ${page} #${i}`);
      lhrs.push(
        lighthouse(
          `${APP_URL}${page}`,
          join(dir, `${page === '/' ? 'home' : page.slice(1)}-${i}.json`),
        ),
      );
    }
    const cat = (c: string): string =>
      String(Math.round(median(lhrs.map((l) => (l.categories[c]?.score ?? 0) * 100))));
    const val = (id: string, k: number): string =>
      median(lhrs.map((l) => (l.audits[id]?.numericValue ?? NaN) * k)).toFixed(k === 1000 ? 0 : 0);
    const last = lhrs[lhrs.length - 1];
    const failing = Object.values(last?.audits ?? {})
      .filter(
        (a) =>
          a.score !== null &&
          a.score < 0.9 &&
          (a.scoreDisplayMode === 'binary' ||
            a.scoreDisplayMode === 'numeric' ||
            a.scoreDisplayMode === 'metricSavings'),
      )
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    sections.push(
      [
        `## \`${page}\``,
        '',
        '| Performance | Accessibility | Best Practices | SEO |',
        '| --: | --: | --: | --: |',
        `| ${cat('performance')} | ${cat('accessibility')} | ${cat('best-practices')} | ${cat('seo')} |`,
        '',
        `| ${METRICS.map(([, t]) => t).join(' | ')} |`,
        `| ${METRICS.map(() => '--:').join(' | ')} |`,
        `| ${METRICS.map(([id, , k]) => val(id, k)).join(' | ')} |`,
        '',
        'CLS ×1000. Проблеми (аудити з оцінкою < 0,9, останній прогін):',
        '',
        ...(failing.length === 0
          ? ['- немає']
          : failing.map(
              (a) => `- \`${a.id}\` — ${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`,
            )),
        '',
      ].join('\n'),
    );
  }
  const md = [
    `# Lighthouse: ${label}`,
    '',
    `- Версія (\`/version\`): \`${version}\` · ${new Date().toISOString()}`,
    `- ${LIGHTHOUSE}, mobile preset (simulated throttling), ${runs} прогони на сторінку — медіана`,
    `- Відтворити: \`make lighthouse\` (стенд піднятий \`make load\`); сирі звіти — \`reports/perf/lighthouse-${label}/\``,
    '',
    ...sections,
  ].join('\n');
  writeFileSync(join(ROOT, 'docs', 'perf', `lighthouse-${label}.md`), md);
  log(`report → docs/perf/lighthouse-${label}.md`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
