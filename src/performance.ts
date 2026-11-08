/** Bounded, local timings. No state, chat text, or author inputs are recorded. */
export interface PerformanceSample { phase: string; durationMs: number; ok: boolean }
export class PerformanceTrace {
  #samples: PerformanceSample[] = [];
  static record(trace: PerformanceTrace, phase: string, started: number, ok: boolean): void {
    // Diagnostics cannot replace execution, forge results or throw into a save.
    if (!trace || typeof trace !== 'object' || !(#samples in trace)) return;
    trace.#samples.push({ phase, durationMs: performance.now() - started, ok });
    if (trace.#samples.length > 160) trace.#samples.splice(0, trace.#samples.length - 160);
  }
  read(): PerformanceSample[] { return this.#samples.map(sample => ({ ...sample })); }
  clear(): void { this.#samples = []; }
}
Object.freeze(PerformanceTrace);

// Execute in module-owned functions, never through an overridable observer.
export function measureSync<T>(trace: PerformanceTrace, phase: string, task: () => T): T {
  const started = performance.now(); let ok = false;
  try { const result = task(); ok = true; return result; }
  finally { PerformanceTrace.record(trace, phase, started, ok); }
}
export async function measure<T>(trace: PerformanceTrace, phase: string, task: () => Promise<T>): Promise<T> {
  const started = performance.now(); let ok = false;
  try { const result = await task(); ok = true; return result; }
  finally { PerformanceTrace.record(trace, phase, started, ok); }
}
