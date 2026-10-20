# Architecture

## Component map

```
src/
├── main.tsx                 entry — mounts <App/>, runs monacoSetup once
├── App.tsx                  shell state: language, code per language, console
│                            events, run lifecycle, draggable divider
├── editor/
│   ├── monacoSetup.ts       bundles monaco-editor from npm; ?worker language services
│   ├── CodeEditor.tsx       Monaco wrapper; Ctrl/Cmd+Enter → run; per-language models
│   └── samples.ts           curated examples (incl. kill-switch demos)
├── runtime/                 *** execution core ***
│   ├── types.ts             WorkerIn/WorkerOut message protocol
│   ├── versions.ts          pinned versions (monaco 0.57.0, pyodide 0.29.5, quickjs 0.32.0)
│   ├── python.worker.ts     Pyodide (CDN ESM) in a module worker
│   ├── javascript.worker.ts QuickJS (npm bundle) in a module worker
│   └── supervisor.ts        RuntimeSupervisor — lifecycle + timeout kill switch
├── console/ConsolePanel.tsx streaming output, auto-scroll, run summary
├── components/              Toolbar (languages, examples, format, run/stop),
│                            StatusBar (runtime identity, status, last-run stats)
└── format/formatter.ts      Prettier standalone, lazy-loaded, JS only in v1
```

## The worker protocol

All runtime communication goes through one small typed protocol (`runtime/types.ts`):

```ts
// main → worker
{ id: number; type: 'ping' }              // warm-up check
{ id: number; type: 'run'; code: string } // execute

// worker → main
{ id: number; type: 'ready' }
{ id: number; type: 'output'; stream: 'stdout' | 'stderr'; text: string }
{ id: number; type: 'done'; durationMs: number }
{ id: number; type: 'error'; message: string; durationMs: number }
```

`id: 0` is reserved for the warm-up ping; run ids start at 1. The supervisor ignores messages
whose id doesn't match the in-flight run, so a late message from a killed worker can never
corrupt a later run's console.

## Run lifecycle

```
user hits Run / Ctrl+Enter
        │
        ▼
supervisor.run(code) ── worker missing? ──▶ spawn() → status 'loading'
        │                                     post {ping}
        │                                           │
        │                                    worker loads runtime
        │                                    (Pyodide CDN / QuickJS wasm)
        │                                           │
        │                                    reply {ready} → status 'ready'
        ▼                                           │
startRun: status 'running', arm timeout ────────────┘
        │
        ├─▶ {output} events stream to console (capped at MAX_OUTPUT_CHARS)
        │
        ├─▶ {done}  → status 'ready', resolve {status:'ok'}
        ├─▶ {error} → status 'ready', resolve {status:'error'}
        ├─▶ timeout → worker.terminate(), status 'ready',
        │             resolve {status:'timeout'}; next run respawns
        └─▶ user Stop → same terminate path, resolve {status:'stopped'}
```

Key invariants:

- **At most one run per language at a time.** `run()` while busy resolves immediately with an
  error; the UI disables Run while `status === 'running'`.
- **The supervisor never trusts the worker to stop itself.** The timeout lives on the main
  thread; termination is unconditional.
- **Warm workers are reused** across runs (REPL-like persistence) until killed.

## Why each runtime loads the way it does

| Runtime | Loading strategy | Rationale |
|---|---|---|
| Monaco | Bundled from npm (`monaco-editor`), workers via `?worker` | Full offline build, version-pinned, no CDN drift |
| Pyodide | ESM from pinned jsDelivr URL at worker start (`@vite-ignore`) | ~10 MB of WASM stays out of the app bundle; cached by the browser after first load |
| QuickJS | Bundled from npm (`quickjs-emscripten`) | Small (~1 MB); bundler resolves its WASM asset |
| Prettier | Lazy dynamic `import()` on first Format | Only JS formatters pay the download cost |

## Adding a new language

1. Add the id to `LanguageId` in `runtime/types.ts`.
2. Add a `<id>.worker.ts` implementing the `WorkerIn`/`WorkerOut` protocol (copy
   `javascript.worker.ts` — it's the simpler template).
3. Register it in `createSupervisor()` in `runtime/supervisor.ts`.
4. Add samples in `editor/samples.ts`, a tab in `Toolbar.tsx`, and a label in
   `StatusBar.tsx`.

Good next candidates: **TypeScript** (transpile with the TypeScript compiler API, then feed
the output to the QuickJS worker — no new sandbox needed), **Lua** (`wasmoon`), **Ruby**
(`ruby.wasm`).

## Known limitations

- **No stdin.** `input()` / `prompt()` block with nowhere to read from. The planned fix is a
  virtual terminal backed by `SharedArrayBuffer` + `Atomics.wait` (requires COOP/COEP
  headers), or a pre-run stdin text box fed into the worker.
- **Python formatting** needs Black under Pyodide — a second heavy payload; deferred until
  there's demand (lazy-load on first use, same pattern as Prettier).
- **QuickJS has no timers, fetch, or DOM** — by design. Document it in examples rather than
  shimming it; shims would widen the capability surface (see `docs/SECURITY.md`).
- **Run state persists** in a warm worker until it's killed. Fine for a playground; a shared
  hosted version should reset per run.
