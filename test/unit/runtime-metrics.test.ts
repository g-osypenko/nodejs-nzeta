import { describe, expect, it } from 'vitest';
import { createRuntimeMetrics } from '../../src/shared/runtime-metrics.js';
import { createTestApp } from '../support/app.js';

describe('runtime metrics for load tests (spec §9)', () => {
  it('cumulative CPU and ELU grow with work done on the main thread', async () => {
    const m = createRuntimeMetrics();
    try {
      const before = m.snapshot(false);
      // Spin until the OS has charged 50 ms of CPU to the process. A fixed wall-time spin is not
      // enough: on a loaded host the thread is preempted and wall time passes without CPU time
      // (the very "CPU vs waiting" difference these metrics exist to show).
      const cpu0 = process.cpuUsage();
      const deadline = performance.now() + 5000;
      let spunMs = 0;
      const start = performance.now();
      while (process.cpuUsage(cpu0).user < 50_000 && performance.now() < deadline) {
        spunMs = performance.now() - start;
      }
      // ELU is accounted at event-loop iteration boundaries: let the loop turn once.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const after = m.snapshot(true);
      const cpuMs = after.cpuUserMs + after.cpuSystemMs - (before.cpuUserMs + before.cpuSystemMs);
      expect(cpuMs).toBeGreaterThanOrEqual(50);
      // ELU counts wall time the loop was busy, so it covers the whole spin, preempted or not.
      expect(after.elu.activeMs - before.elu.activeMs).toBeGreaterThanOrEqual(spunMs * 0.9);
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
