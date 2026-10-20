import { DEFAULT_TIMEOUT_MS } from './versions';
import type {
  LanguageId,
  OutputEvent,
  RunResult,
  RuntimeStatus,
  WorkerIn,
  WorkerOut,
} from './types';

export interface SupervisorCallbacks {
  onOutput: (e: OutputEvent) => void;
  onStatus: (s: RuntimeStatus) => void;
}

interface PendingRun {
  id: number;
  t0: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: RunResult) => void;
}

/**
 * Owns the lifecycle of one language runtime worker.
 *
 * Guarantees:
 *  - The worker is created lazily and warmed up on first use.
 *  - A run that exceeds `timeoutMs` is killed via worker.terminate() —
 *    the only reliable way to stop an infinite loop, since neither Pyodide
 *    nor QuickJS can always be interrupted from the inside.
 *  - After a kill, the next run transparently respawns a fresh runtime.
 *  - The user can stop a run early with stop().
 */
export class RuntimeSupervisor {
  private worker: Worker | null = null;
  private ready = false;
  private pending: PendingRun | null = null;
  private queued: { code: string; resolve: (r: RunResult) => void } | null = null;
  private nextId = 0;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly cb: SupervisorCallbacks,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  get status(): RuntimeStatus {
    if (this.pending) return 'running';
    if (!this.worker) return 'idle';
    return this.ready ? 'ready' : 'loading';
  }

  /** Run `code`. Rejects immediately if another run is in progress. */
  run(code: string): Promise<RunResult> {
    if (this.pending) {
      return Promise.resolve({
        status: 'error',
        durationMs: 0,
        error: 'A run is already in progress.',
      });
    }
    this.spawn();
    return new Promise<RunResult>((resolve) => {
      if (this.ready) {
        this.startRun(code, resolve);
      } else {
        // Runtime still warming up — start the run as soon as it is ready.
        this.queued = { code, resolve };
      }
    });
  }

  /** Stop the current run (user-initiated). */
  stop(): void {
    const run = this.pending;
    if (!run) return;
    clearTimeout(run.timer);
    this.terminateWorker();
    this.cb.onOutput({ stream: 'system', text: '\n■ Execution stopped by user.\n' });
    run.resolve({ status: 'stopped', durationMs: performance.now() - run.t0 });
    this.pending = null;
    this.cb.onStatus('ready');
  }

  dispose(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.terminateWorker();
    this.pending = null;
    this.queued = null;
  }

  /* ------------------------------ internals ------------------------------ */

  private spawn(): void {
    if (this.worker) return;
    this.cb.onStatus('loading');
    const w = this.createWorker();
    w.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(e.data);
    w.onerror = (e: ErrorEvent) => {
      this.failAll(`Worker crashed: ${e.message || 'unknown error'}`);
    };
    this.worker = w;
    // id 0 is reserved for the warm-up ping.
    w.postMessage({ id: 0, type: 'ping' } satisfies WorkerIn);
  }

  private onMessage(m: WorkerOut): void {
    if (m.type === 'ready') {
      this.ready = true;
      this.cb.onStatus('ready');
      if (this.queued) {
        const { code, resolve } = this.queued;
        this.queued = null;
        this.startRun(code, resolve);
      }
      return;
    }
    const run = this.pending;
    if (!run || m.id !== run.id) return; // stale message from a previous run

    if (m.type === 'output') {
      this.cb.onOutput({ stream: m.stream, text: m.text });
      return;
    }
    clearTimeout(run.timer);
    this.pending = null;
    this.cb.onStatus('ready');
    if (m.type === 'done') {
      run.resolve({ status: 'ok', durationMs: m.durationMs });
    } else {
      run.resolve({ status: 'error', durationMs: m.durationMs, error: m.message });
    }
  }

  private startRun(code: string, resolve: (r: RunResult) => void): void {
    const id = ++this.nextId;
    const t0 = performance.now();
    const timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
    this.pending = { id, t0, timer, resolve };
    this.cb.onStatus('running');
    this.worker!.postMessage({ id, type: 'run', code, timeoutMs: this.timeoutMs } satisfies WorkerIn);
  }

  private onTimeout(): void {
    const run = this.pending;
    if (!run) return;
    this.pending = null;
    this.terminateWorker();
    this.cb.onOutput({
      stream: 'system',
      text: `\n⏱ Execution timed out after ${this.timeoutMs}ms — worker terminated and runtime will respawn on next run.\n`,
    });
    run.resolve({
      status: 'timeout',
      durationMs: performance.now() - run.t0,
      error: `Timed out after ${this.timeoutMs}ms`,
    });
    this.cb.onStatus('ready');
  }

  private failAll(message: string): void {
    this.terminateWorker();
    this.cb.onOutput({ stream: 'system', text: `\n${message}\n` });
    this.cb.onStatus('error');
    if (this.pending) {
      const run = this.pending;
      clearTimeout(run.timer);
      this.pending = null;
      run.resolve({ status: 'error', durationMs: performance.now() - run.t0, error: message });
    }
    this.queued = null;
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
  }
}

export function createSupervisor(
  language: LanguageId,
  cb: SupervisorCallbacks,
  timeoutMs?: number,
): RuntimeSupervisor {
  const createWorker =
    language === 'python'
      ? () => new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })
      : () => new Worker(new URL('./javascript.worker.ts', import.meta.url), { type: 'module' });
  return new RuntimeSupervisor(createWorker, cb, timeoutMs);
}
