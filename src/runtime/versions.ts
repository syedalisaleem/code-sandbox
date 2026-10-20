/**
 * Single source of truth for pinned runtime versions.
 * Verified against the npm registry on 2026-10-20.
 */
export const MONACO_VERSION = '0.57.0';

/** Pyodide is loaded from a CDN at runtime (not bundled) — see python.worker.ts. */
export const PYODIDE_VERSION = '0.29.5';
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/full/`;

/** QuickJS is bundled via npm — see javascript.worker.ts. */
export const QUICKJS_VERSION = '0.32.0';

/** Wall-clock budget per run before the supervisor kills the worker. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Cap on buffered console output per run; oldest output is dropped past this. */
export const MAX_OUTPUT_CHARS = 200_000;
