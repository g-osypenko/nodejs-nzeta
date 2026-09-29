import { buildApp } from './app.js';

const isSmokeTest = process.argv.includes('--smoke-test');
const app = buildApp();

async function main(): Promise<void> {
  if (isSmokeTest) {
    await app.ready();
    await app.close();
    process.stdout.write('Smoke test passed: server instantiates without errors.\n');
    process.exit(0);
  }

  const port = Number(process.env['PORT']) || 3000;
  const host = process.env['HOST'] || '0.0.0.0';

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
