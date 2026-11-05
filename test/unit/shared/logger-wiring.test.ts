import { afterEach, describe, expect, it } from 'vitest';
import { createContext, runWithContext, setCurrentUser } from '../../../src/shared/context.js';
import { createLogger } from '../../../src/shared/logger.js';

// Added after mutation testing: `pino({})` (logger WITHOUT the mixin) survived, because only
// contextFields() was tested, not that the real logger uses it (docs/testing/mutation-report.md).
function capture(): { lines: Record<string, unknown>[]; stream: { write(s: string): void } } {
  const lines: Record<string, unknown>[] = [];
  return { lines, stream: { write: (s: string): void => void lines.push(JSON.parse(s)) } };
}

describe('logger wiring', () => {
  const saved = process.env['LOG_LEVEL'];
  afterEach(() => {
    if (saved === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = saved;
  });

  it('every line written inside a request carries reqId, processId and userId', () => {
    const { lines, stream } = capture();
    const log = createLogger(stream, 'info');
    runWithContext(createContext({ requestId: 'r-1', processId: 'p-1' }), () => {
      log.info('anonymous');
      setCurrentUser({ id: 'u-1', email: 'u@test.local', role: 'USER' });
      log.info({ orderId: 'o-1' }, 'with user');
    });
    expect(lines[0]).toMatchObject({ msg: 'anonymous', reqId: 'r-1', processId: 'p-1' });
    expect(lines[1]).toMatchObject({
      msg: 'with user',
      reqId: 'r-1',
      processId: 'p-1',
      userId: 'u-1',
      orderId: 'o-1',
    });
  });

  it('outside a request no correlation fields are invented', () => {
    const { lines, stream } = capture();
    createLogger(stream, 'info').info('boot');
    expect(lines[0]).not.toHaveProperty('reqId');
    expect(lines[0]).not.toHaveProperty('processId');
  });

  it('level defaults to info and follows LOG_LEVEL', () => {
    delete process.env['LOG_LEVEL'];
    const a = capture();
    const byDefault = createLogger(a.stream);
    byDefault.debug('hidden');
    byDefault.info('shown');
    expect(a.lines.map((l) => l['msg'])).toEqual(['shown']);

    process.env['LOG_LEVEL'] = 'debug';
    const b = capture();
    createLogger(b.stream).debug('visible');
    expect(b.lines.map((l) => l['msg'])).toEqual(['visible']);
  });
});
