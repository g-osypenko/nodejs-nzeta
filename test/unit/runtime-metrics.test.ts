import { describe, expect, it } from 'vitest';
import { createRuntimeMetrics } from '../../src/shared/runtime-metrics.js';
import { createTestApp } from '../support/app.js';

describe('runtime metrics for load tests (spec §9)', () => {
  it('cumulative CPU and ELU grow with work done on the main thread', async () => {
    const m = createRuntimeMetrics();
    try {
      const before = m.snapshot(false);
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // busy main thread for ~30 ms
      }
      // ELU is accounted at event-loop iteration boundaries: let the loop turn once.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const after = m.snapshot(true);
      expect(after.cpuUserMs + after.cpuSystemMs).toBeGreaterThan(
        before.cpuUserMs + before.cpuSystemMs,
      );
      expect(after.elu.activeMs).toBeGreaterThan(before.elu.activeMs);
      expect(after.memoryMb.rss).toBeGreaterThan(0);
      expect(after.eventLoopDelayMs.p99).toBeGreaterThanOrEqual(after.eventLoopDelayMs.p50);
    } finally {
      m.stop();
    }
  });

  it('GET /debug/runtime exists only with DEBUG_RUNTIME=true', async () => {
    const on = await createTestApp({ DEBUG_RUNTIME: 'true' });
    const off = await createTestApp();
    try {
      const res = await on.app.inject({ method: 'GET', url: '/debug/runtime?reset=1' });
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json<Record<string, unknown>>()).sort()).toEqual([
        'cpuSystemMs',
        'cpuUserMs',
        'elu',
        'eventLoopDelayMs',
        'memoryMb',
        'uptimeMs',
      ]);
      expect((await off.app.inject({ method: 'GET', url: '/debug/runtime' })).statusCode).toBe(404);
    } finally {
      await on.close();
      await off.close();
    }
  });
});
