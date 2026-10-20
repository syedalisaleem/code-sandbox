/** Languages with a bundled execution runtime. */
export type LanguageId = 'python' | 'javascript';

export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error';

export type OutputStream = 'stdout' | 'stderr' | 'system';

export interface OutputEvent {
  stream: OutputStream;
  text: string;
}

export type RunStatus = 'ok' | 'error' | 'timeout' | 'stopped';

export interface RunResult {
  status: RunStatus;
  /** Wall-clock time of the run in milliseconds. */
  durationMs: number;
  /** Human-readable failure reason (for error/timeout/stopped). */
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Worker message protocol (main thread <-> runtime Web Worker)        */
/* ------------------------------------------------------------------ */

/** Main -> worker */
export type WorkerIn =
  | { id: number; type: 'ping' }
  | { id: number; type: 'run'; code: string; timeoutMs: number };

/** Worker -> main */
export type WorkerOut =
  | { id: number; type: 'ready' }
  | { id: number; type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { id: number; type: 'done'; durationMs: number }
  | { id: number; type: 'error'; message: string; durationMs: number };
