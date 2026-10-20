# ⌁ code-sandbox

An in-browser interactive code execution sandbox — a LeetCode/CodePen-style workspace that
**compiles, formats, and runs code snippets securely with live console output**, entirely
client-side.

- **Editor:** Monaco Editor (the engine behind VS Code)
- **Python:** Pyodide — CPython compiled to WebAssembly
- **JavaScript:** QuickJS compiled to WebAssembly (deliberately *not* the page's own JS engine)
- **Isolation:** each runtime lives in a dedicated Web Worker with zero network capability
- **Kill switch:** runs that exceed the timeout are stopped with `worker.terminate()` and the
  runtime respawns transparently on the next run

## Quickstart

```bash
npm install
npm run dev      # → http://localhost:5173
```

```bash
npm run build    # typecheck + production build
npm run preview  # serve the production build locally
```

No backend, no API keys, no special server headers. Deploy the `dist/` output to any static
host (Vercel, Netlify, GitHub Pages, Cloudflare Pages).

> First run per language downloads its runtime (Pyodide ≈ 10 MB from a pinned CDN, cached by
> the browser afterwards). The UI shows a loading state while the worker warms up.

## Project layout

```
src/
├── main.tsx                 # entry: mounts <App/>, configures Monaco once
├── App.tsx                  # shell: toolbar, resizable editor/console split, status bar
├── index.css                # dark theme, layout, console styling
├── editor/
│   ├── monacoSetup.ts       # bundles monaco-editor from npm + ?worker language services
│   ├── CodeEditor.tsx       # Monaco wrapper (Ctrl+Enter to run, per-language models)
│   └── samples.ts           # curated examples, incl. kill-switch demos
├── runtime/                 # execution core — the interesting part
│   ├── types.ts             # worker message protocol + shared types
│   ├── versions.ts           # single source of truth for pinned versions
│   ├── python.worker.ts     # Pyodide in a Web Worker, stdout/stderr capture
│   ├── javascript.worker.ts # QuickJS in a Web Worker, memory cap + interrupt handler
│   └── supervisor.ts        # RuntimeSupervisor: lifecycle, timeout kill-switch, respawn
├── console/
│   └── ConsolePanel.tsx     # streaming output, auto-scroll, run summary
├── components/
│   ├── Toolbar.tsx          # language tabs, examples, format, run/stop
│   └── StatusBar.tsx        # runtime identity + status + last-run stats
└── format/
    └── formatter.ts         # Prettier standalone (JS) — runs fully client-side

docs/
├── ARCHITECTURE.md          # component map, message protocol, run lifecycle, extending
└── SECURITY.md              # threat model, sandboxing layers, phase-2 Docker backend design
```

## How execution works

```
┌─────────────┐   postMessage    ┌──────────────────────┐
│  React UI   │ ──────────────▶ │  RuntimeSupervisor     │
│  (main      │ ◀────────────── │  (main thread)         │
│   thread)   │   output events │                        │
└─────────────┘                 │  timeout ──▶ terminate │
                                └──────────┬─────────────┘
                                           │ spawn
                              ┌────────────▼─────────────┐
                              │  Web Worker              │
                              │  ┌────────────────────┐  │
                              │  │ Pyodide │ QuickJS  │  │
                              │  │  (WASM)   (WASM)   │  │
                              │  └────────────────────┘  │
                              │  no DOM · no network     │
                              └──────────────────────────┘
```

1. `RuntimeSupervisor.run(code)` lazily spawns the language worker and pings it; the UI shows
   `loading` until the runtime replies `ready`.
2. Code is posted to the worker. `stdout`/`stderr` stream back as output events; completion
   arrives as `done` or `error` with wall-clock duration.
3. A supervisor-side timer is the hard execution budget (default 10 s). On expiry the worker is
   **terminated** — the only reliable way to stop `while (true) {}` — and the next run respawns
   a fresh runtime. QuickJS adds two inner guards: a 64 MB memory limit and an interrupt
   handler budgeted at `timeoutMs - 1s`, so the in-guest guard fires first and the runtime
   stays warm (no respawn needed).
4. The user can also stop a run early; the Stop button uses the same terminate path.

## Demos worth trying

- JavaScript → Examples → **Infinite loop (kill switch)**: watch the timeout fire and the
  runtime respawn.
- Python → Examples → **Traceback demo**: Python tracebacks stream through as `stderr`.
- Press **Ctrl+Enter** anywhere in the editor to run.

## Design decisions (the short version)

- **WASM-first, not Docker-first.** For a single-user workspace, in-browser WASM runtimes give
  real isolation (WASM linear memory + worker thread + no network capability) with zero
  infrastructure. Docker/gVisor microVMs are the phase-2 story for untrusted multi-tenant
  execution — designed in `docs/SECURITY.md`, not built prematurely.
- **QuickJS instead of `eval`.** Running user JS in the page's engine would share the origin's
  privileges. QuickJS gives a fresh empty global, memory limits, and interrupt handlers by
  construction.
- **Supervisor owns the timeout.** Neither interpreter can reliably interrupt itself, so the
  kill switch lives outside the sandbox, on the main thread.
- **Pyodide loads from a pinned CDN** (`src/runtime/versions.ts`) rather than being bundled —
  ~10 MB of WASM has no business in the app bundle. QuickJS is small enough to bundle via npm.

## Roadmap

- [ ] Python formatting (Black via a lazily-loaded Pyodide package)
- [ ] stdin support (shared-memory prompt or a virtual terminal)
- [ ] More runtimes: TypeScript (transpile-then-QuickJS), Lua, Ruby via WASM
- [ ] Shareable snippets (URL-hash encoded)
- [ ] Phase-2 execution backend: isolated Docker/gVisor workers behind an API (`docs/SECURITY.md`)

---

## Live demo

**https://syedalisaleem.github.io/code-sandbox/**

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) type-checks, builds and deploys
`dist/` to GitHub Pages on every push to `main`. `base: './'` in `vite.config.ts` keeps
the asset and worker URLs relative so the same build works from a project subpath or a
custom domain.