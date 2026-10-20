/// <reference lib="webworker" />
/**
 * Python runtime worker.
 *
 * Loads Pyodide (CPython compiled to WebAssembly) from a pinned CDN inside a
 * dedicated Web Worker. The worker has no DOM access and is never given any
 * network capability, so user code is confined to the WASM sandbox.
 *
 * Infinite loops cannot be interrupted from inside the interpreter — the
 * supervisor on the main thread enforces the timeout with worker.terminate()
 * and respawns a fresh runtime on the next run.
 */
import { PYODIDE_CDN } from './versions';
import type { WorkerIn, WorkerOut } from './types';

interface Pyodide {
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
  runPythonAsync(code: string): Promise<unknown>;
}

type LoadPyodide = (opts: { indexURL: string }) => Promise<Pyodide>;

function post(msg: WorkerOut): void {
  postMessage(msg);
}

let pyodide: Pyodide | null = null;
let loadPromise: Promise<void> | null = null;
/** Id of the run currently executing; stdout/stderr are tagged with it. */
let activeId = 0;

async function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      // @vite-ignore: load the pinned Pyodide ESM build straight from the CDN
      // at runtime instead of bundling ~10MB of WASM into the app.
      const mod = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as {
        loadPyodide: LoadPyodide;
      };
      pyodide = await mod.loadPyodide({ indexURL: PYODIDE_CDN });
      pyodide.setStdout({
        batched: (s) => post({ id: activeId, type: 'output', stream: 'stdout', text: s }),
      });
      pyodide.setStderr({
        batched: (s) => post({ id: activeId, type: 'output', stream: 'stderr', text: s }),
      });
    })();
  }
  await loadPromise;
}

onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;

  if (msg.type === 'ping') {
    try {
      await ensureLoaded();
      post({ id: msg.id, type: 'ready' });
    } catch (err) {
      // Surface load failures (e.g. CDN unreachable) as a run error on ping.
      post({
        id: msg.id,
        type: 'error',
        message: `Failed to load the Python runtime: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      });
    }
    return;
  }

  activeId = msg.id;
  const t0 = performance.now();
  try {
    await ensureLoaded();
    await pyodide!.runPythonAsync(msg.code);
    post({ id: msg.id, type: 'done', durationMs: performance.now() - t0 });
  } catch (err) {
    // Python tracebacks arrive here as PythonError; err.message holds them.
    post({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - t0,
    });
  }
};
