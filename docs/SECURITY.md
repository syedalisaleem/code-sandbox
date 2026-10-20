# Security design

This document is the threat model and sandboxing rationale for `code-sandbox`. It is written
to be read by a reviewer: what we defend against, what each layer buys us, what we explicitly
do **not** defend against, and how the design scales to untrusted multi-tenant execution.

## 1. Threat model

**Assets:** the user's browser session (cookies, localStorage, open tabs), the user's device
(CPU, memory, battery), and — in a future hosted version — other users' code and our
infrastructure.

**Adversary:** arbitrary code typed (or pasted) into the editor by anyone who can reach the
page. Assume it is actively malicious: infinite loops, memory bombs, attempts to exfiltrate
data, attempts to escape into the host page.

**Out of scope for v1 (single-user, client-side):**
- Protecting the user's *own* code from the user (meaningless — it's their browser).
- Side-channel attacks (Spectre-class) beyond what the browser already mitigates.
- Malicious *runtimes* — we trust Pyodide and QuickJS builds from pinned, checksummed origins.

## 2. Defense in depth — the five layers

### Layer 1 — WebAssembly linear memory
Both runtimes (Pyodide's CPython, QuickJS) execute as WASM modules. WASM gives a sandboxed
linear memory: guest code cannot address host memory outside its own sandbox, and all host
interaction goes through explicitly exported functions. There is no raw `mmap`, no
`process`, no ambient authority — a WASM module starts with *nothing* and only gains what we
hand it.

### Layer 2 — Web Worker thread isolation
Each runtime lives in a **dedicated** Web Worker (one per language, respawned per kill).
Workers have no DOM access: no `document`, no `window`, no cookies, no localStorage. Even a
full guest escape from the WASM sandbox lands in a worker global scope, which is nearly
empty by construction.

### Layer 3 — Zero network capability
The workers are never given `fetch`, `XMLHttpRequest`, WebSockets, or any socket-like API.
- Pyodide is loaded with only its stdlib; we do not expose any host fetch bridge.
- The QuickJS context is built from an empty global: the *only* host function installed is
  `console.log`, which serializes values and posts them to the main thread.

No network capability means the classic exfiltration and SSRF paths do not exist, regardless
of what the guest code attempts. This is capability-based security: instead of filtering bad
URLs, we never grant the capability at all.

### Layer 4 — Execution timeout via supervisor kill switch
Neither CPython nor QuickJS can reliably interrupt arbitrary guest code from the inside
(Pyodide has no signal delivery for `while True: pass`; QuickJS's interrupt handler covers
sync JS but not every pathological case). Therefore the timeout **lives outside the sandbox**:
`RuntimeSupervisor` (`src/runtime/supervisor.ts`) arms a wall-clock timer on the main thread,
and on expiry calls `worker.terminate()` — the OS/thread-level kill that cannot be caught or
ignored by guest code. The next run transparently respawns a fresh runtime.

Default budget: 10 s (`DEFAULT_TIMEOUT_MS` in `src/runtime/versions.ts`).

### Layer 5 — Memory and output bounds
- QuickJS: `runtime.setMemoryLimit(64 MB)` — allocation beyond the cap throws inside the
  guest instead of growing the tab's memory.
- Console output is capped at 200 kB per run (`MAX_OUTPUT_CHARS`); oldest output is dropped.
  This bounds both DOM size and `postMessage` traffic against output bombs like
  `while True: print("x" * 10**6)`.

## 3. Why QuickJS instead of `eval` / `new Function`

Running user JavaScript in the page's own engine would execute with the page's origin
privileges: access to `fetch` (with the user's cookies), `localStorage`, and the DOM. A
`new Function` sandbox is not a sandbox — it's a suggestion. QuickJS compiled to WASM gives:

| Property | Page engine (`eval`) | QuickJS in WASM worker |
|---|---|---|
| Global scope | Shared with app | Fresh, empty per run |
| Network APIs | Available | Do not exist |
| Memory limit | None | 64 MB, enforced |
| Interrupt | None | Interrupt handler + supervisor kill |
| DOM access | Full | Impossible (worker has none) |

## 4. Residual risks (stated honestly)

1. **CPU burn within budget.** A 10-second busy loop is allowed; it will spin one core for
   10 s. Acceptable for a dev tool; a hosted version would need cgroup CPU quotas.
2. **Pyodide payload trust.** We load Pyodide from jsDelivr, pinned to 0.29.5. A compromised
   CDN could ship malicious WASM — mitigated in a hardened deploy with subresource integrity
   (SRI) hashes on the pinned files.
3. **Browser zero-days.** WASM sandbox escapes are rare but not impossible; we inherit the
   browser's patching. A hosted multi-tenant version must not rely on the browser at all
   (see §5).
4. **No persistence boundary needed.** Runs share one worker per language until killed, so a
   previous run's globals persist (REPL-like). This is a feature for a playground, but a
   hosted version should reset state per run.

## 5. Phase-2 design: hosted execution backend for untrusted multi-tenant use

When code comes from *other* users (shared playground, interview platform, classroom), the
browser sandbox is the wrong trust boundary — the attacker's code would run in the victim's
browser. The phase-2 backend moves execution server-side:

```
client ──HTTPS──▶ API gateway ──▶ job queue ──▶ pool of microVM workers
                                              (Firecracker / gVisor per run)
```

Per-run isolation recipe (one container/VM per execution, destroyed afterwards):

- **gVisor (`runsc`) or Firecracker microVMs** — a second kernel boundary beyond plain
  namespaces/cgroups; container escape must then beat both the OCI runtime *and* the
  sandbox kernel.
- **Hardening flags:** `--network none` (or an egress proxy allowlist), `--read-only`
  root filesystem, `--pids-limit`, `--memory`/`--cpus` quotas, `--cap-drop=ALL`,
  seccomp default-deny profile, no-new-privileges.
- **Timeouts at two levels:** in-guest watchdog *and* orchestrator kill (same supervisor
  pattern as v1, moved server-side).
- **No secret mounting:** the worker image contains only the language toolchain; API keys
  and user data never enter the execution environment.
- **Output capture** over a pipe with the same size cap as v1; run metadata (duration,
  exit code, OOM/timeout) returned as structured JSON.

The v1 client keeps working unchanged against this backend: `RuntimeSupervisor` gains a
`RemoteSupervisor` implementation behind the same interface, posting code to the API instead
of a worker. The UI, protocol types, and timeout semantics are already backend-agnostic —
that seam was designed in from the start.

## 6. Deployment checklist (static hosting)

- [ ] Serve over HTTPS (required for workers + WASM in some browsers).
- [ ] No `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` needed — neither
      runtime requires `SharedArrayBuffer`.
- [ ] Add a strict `Content-Security-Policy` (e.g. `script-src 'self' cdn.jsdelivr.net`)
      once the Pyodide CDN origin is finalized; add SRI hashes for the pinned files.
- [ ] Consider pinning the Pyodide payload to your own CDN/host for supply-chain control.
