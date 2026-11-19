// Pre-compresses the build (web/dist) once at build time: Fastify serves *.br / *.gz by
// Accept-Encoding (@fastify/static preCompressed), so no CPU is spent compressing per request on
// the 1-vCPU instance (Lighthouse baseline: 324 KB transferred uncompressed — docs/perf/).
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const COMPRESSIBLE = /\.(js|css|html|svg|json|txt)$/; // not .map: only DevTools fetches source maps
const MIN_BYTES = 1024;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

let before = 0;
let after = 0;
for await (const file of files(DIST)) {
  if (!COMPRESSIBLE.test(file) || (await stat(file)).size < MIN_BYTES) continue;
  const raw = await readFile(file);
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  await writeFile(`${file}.br`, br);
  await writeFile(`${file}.gz`, gzipSync(raw, { level: 9 }));
  if (!file.endsWith('.map')) {
    before += raw.length;
    after += br.length;
  }
}
console.log(
  `precompressed: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB brotli`,
);
