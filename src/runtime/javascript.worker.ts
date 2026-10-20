/// <reference lib="webworker" />
/**
 * JavaScript runtime worker.
 *
 * Executes user JS inside QuickJS (a small embeddable JS engine) compiled to
 * WebAssembly — deliberately NOT the page's own JS engine. QuickJS gives us:
 *   - a fresh, empty global per run (no DOM, no fetch, no timers, no Node APIs)
 *   - a hard memory limit via runtime.setMemoryLimit
 *   - an interrupt handler as a second-layer guard for runaway sync code
 *
 * The ultimate guard is still the supervisor: worker.terminate() on timeout.
 */
import { getQuickJS, isFail } from 'quickjs-emscripten';
import type { WorkerIn, WorkerOut } from './types';

const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
/** Inner interrupt budget trails the supervisor timeout so the in-guest guard
 *  fires first for JS (keeping the runtime warm); the supervisor's
 *  worker.terminate() remains the hard outer guard. */
const INTERRUPT_HEADROOM_MS = 1_000;
const MAX_PENDING_JOBS = 10_000;

function post(msg: WorkerOut): void {
  postMessage(msg);
}

let quickJS: Awaited<ReturnType<typeof getQuickJS>> | null = null;

onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;

  if (msg.type === 'ping') {
    try {
      if (!quickJS) quickJS = await getQuickJS();
      post({ id: msg.id, type: 'ready' });
    } catch (err) {
      post({
        id: msg.id,
        type: 'error',
        message: `Failed to load the JavaScript runtime: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      });
    }
    return;
  }

  const t0 = performance.now();
  const send = (stream: 'stdout' | 'stderr', text: string) =>
    post({ id: msg.id, type: 'output', stream, text });

  try {
    if (!quickJS) quickJS = await getQuickJS();
    const runtime = quickJS.newRuntime();
    try {
      runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
      // Second-layer defense: ask QuickJS to abort if sync execution runs
      // past its budget. The budget trails the supervisor timeout so this
      // guard fires first; the supervisor's terminate() remains the hard guard.
      const interruptBudget = Math.max(1_000, (msg.timeoutMs || 10_000) - INTERRUPT_HEADROOM_MS);
      const deadline = Date.now() + interruptBudget;
      runtime.setInterruptHandler(() => Date.now() > deadline);

      const context = runtime.newContext();
      try {
        // Minimal console — the only host I/O user code can observe.
        const consoleHandle = context.newObject();
        const logFn = context.newFunction('log', (...args) => {
          const text = args
            .map((a) => {
              const v: unknown = context.dump(a);
              return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
            })
            .join(' ');
          send('stdout', text + '\n');
        });
        context.setProp(consoleHandle, 'log', logFn);
        context.setProp(context.global, 'console', consoleHandle);
        consoleHandle.dispose();
        logFn.dispose();

        const result = context.evalCode(msg.code, 'sandbox.js');
        if (isFail(result)) {
          const errValue: unknown = context.dump(result.error);
          result.error.dispose();
          const message =
            typeof errValue === 'object' && errValue !== null && 'message' in errValue
              ? String((errValue as { message: unknown }).message)
              : JSON.stringify(errValue);
          send('stderr', message + '\n');
          post({ id: msg.id, type: 'error', message, durationMs: performance.now() - t0 });
          return;
        }
        result.value.dispose();

        // Drain the promise job queue so top-level async code completes.
        // (There are no timers in this sandbox by design.)
        let executed = 0;
        for (;;) {
          const pending = runtime.executePendingJobs(MAX_PENDING_JOBS);
          try {
            if (isFail(pending)) {
              const errValue: unknown = context.dump(pending.error);
              send('stderr', `Unhandled promise rejection: ${JSON.stringify(errValue)}\n`);
              break;
            }
            if (pending.value === 0) break;
            executed += pending.value;
            if (executed >= MAX_PENDING_JOBS) break;
          } finally {
            pending.dispose();
          }
        }

        post({ id: msg.id, type: 'done', durationMs: performance.now() - t0 });
      } finally {
        context.dispose();
      }
    } finally {
      runtime.dispose();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: msg.id, type: 'error', message, durationMs: performance.now() - t0 });
  }
};
