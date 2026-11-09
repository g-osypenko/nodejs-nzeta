import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/**
 * Process-level counters for load tests (spec.md §9): they separate "busy CPU" from "waiting".
 * - cpu: user+system time of the whole process, including libuv threadpool work (scrypt).
 * - elu: share of time the main thread's event loop was busy — high ELU = JS on the main thread
 *   is the limit; low ELU with high latency = requests wait (DB, pool, threadpool queue).
 * - eventLoopDelay: how late timers fire — the latency every request pays when the loop is busy.
 * Cumulative values: the load harness diffs two snapshots around a measured run.
 */
export interface RuntimeSnapshot {
  uptimeMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  elu: { idleMs: number; activeMs: number };
  eventLoopDelayMs: { p50: number; p99: number; max: number };
  memoryMb: { rss: number; heapUsed: number };
}

export interface RuntimeMetrics {
  /** `resetDelay` starts a new event-loop delay window (the histogram is not cumulative). */
  snapshot(resetDelay: boolean): RuntimeSnapshot;
  stop(): void;
}

const NS_PER_MS = 1e6;
const round = (n: number): number => Math.round(n * 100) / 100;

export function createRuntimeMetrics(): RuntimeMetrics {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  return {
    snapshot(resetDelay): RuntimeSnapshot {
      const cpu = process.cpuUsage();
      const elu = performance.eventLoopUtilization();
      const mem = process.memoryUsage();
      const snap: RuntimeSnapshot = {
        uptimeMs: round(performance.now()),
        cpuUserMs: round(cpu.user / 1000),
        cpuSystemMs: round(cpu.system / 1000),
        elu: { idleMs: round(elu.idle), activeMs: round(elu.active) },
        eventLoopDelayMs: {
          p50: round(delay.percentile(50) / NS_PER_MS),
          p99: round(delay.percentile(99) / NS_PER_MS),
          max: round(delay.max / NS_PER_MS),
        },
        memoryMb: { rss: round(mem.rss / 2 ** 20), heapUsed: round(mem.heapUsed / 2 ** 20) },
      };
      if (resetDelay) delay.reset();
      return snap;
    },
    stop(): void {
      delay.disable();
    },
  };
}
