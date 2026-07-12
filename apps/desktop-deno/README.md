# Trilium Notes — Deno Desktop prototype

A proof-of-concept desktop shell for Trilium built on [`deno desktop`](https://docs.deno.com/runtime/desktop/)
(experimental since Deno 2.9, June 2026) instead of Electron.

It wraps the **standalone** build (`apps/standalone`): the entire Trilium
stack — client, `@triliumnext/core`, SQLite WASM — runs inside a system
webview exactly as it does in a browser, while this shell provides the
native window, tray, notifications, and filesystem persistence. There is no
Node.js anywhere in the resulting app.

## Architecture

```
┌────────────────────────── native process ──────────────────────────┐
│  Deno runtime (main.ts)              System WebView (WebKitGTK /   │
│  ├─ Deno.serve on 127.0.0.1:<rand>   WebView2)                     │
│  │   ├─ static files from            ├─ Trilium client (Preact)    │
│  │   │  apps/standalone/dist  ◄──────┤ ├─ service worker (sw.js)   │
│  │   └─ /desktop-db  ◄───────────────┤ └─ local-server-worker      │
│  │      (persistence bridge)         │    (core + SQLite WASM)     │
│  ├─ Deno.BrowserWindow + bindings ───┘                             │
│  └─ Deno.Tray, Notification, Deno.dock                             │
└─────────────────────────────────────────────────────────────────────┘
```

Backend ⇄ webview communication is in-process (`win.bind()` / `bindings.*`
in the page) — no IPC, no preload script, no contextBridge.

### Native SQL bridge (persistence)

WebKitGTK webviews do not expose OPFS (`navigator.storage.getDirectory`),
so the SQLite SAHPool VFS is unavailable and the worker would normally fall
back to a throwaway in-memory database. Instead, this shell runs the
database **natively** with Deno's built-in `node:sqlite` and exposes it at
`POST /desktop-sql` (`exec`/`run`/`get`/`all`/`status`/`serialize` ops,
blobs as base64 markers). The worker-side adapter,
`apps/standalone/src/lightweight/bridged_sql_provider.ts`, implements
trilium-core's synchronous `DatabaseProvider` over synchronous XHR (allowed
in dedicated workers), so WASM SQLite is bypassed entirely and the user's
notes live in an ordinary WAL-mode SQLite file at
`$XDG_DATA_HOME/trilium-deno-desktop/document.db` (override with
`TRILIUM_DATA_DIR`) — the same persistence model as the Electron app,
without Node.

The bridge is probed at runtime, so the standalone bundle is unchanged for
the web; probe order is OPFS SAHPool → SQL bridge → legacy snapshot bridge
(`GET`/`PUT /desktop-db`, whole-database copies every 15 s, kept as a
fallback) → in-memory.

## Running

Prerequisites: Deno ≥ 2.9 and a standalone build
(`pnpm --filter standalone build`).

```sh
deno task start      # build + launch
deno task dev        # with HMR
deno task smoke      # TRILIUM_SMOKE=1: self-verifies boot + persistence, then exits
deno task package    # experimental: self-contained AppImage
```

### NixOS

The prebuilt webview backend dynamically links WebKitGTK; use the helper,
which composes an `LD_LIBRARY_PATH` from nixpkgs (needs nix-ld), builds the
bundle, and runs the resulting binary directly with logs visible:

```sh
./run-nixos.sh          # build + launch
./run-nixos.sh smoke    # self-verifying boot + persistence check
```

It falls back to `~/.local/share/deno29/deno` when the `deno` on PATH
predates 2.9 (nixpkgs still ships 2.8), and honors `DENO_BIN`.

## Prototype findings (July 2026)

What works:

- Full Trilium standalone stack boots in the WebKitGTK webview: service
  worker, setup wizard, client UI.
- Native SQLite persistence through the SQL bridge: the smoke test drives
  the real setup flow (schema + demo document import) — ~23k SQL
  operations including blob writes and nested transactions — against
  `node:sqlite`, with the result durable on disk in WAL mode.
- Native tray, notifications, dock badge, `bindings.*` bridge, devtools.
- The shell is a few hundred lines of TypeScript with only `jsr:@std`
  dependencies. Dev bundle: 83 MB runtime + the 78 MB standalone dist
  served from disk. Packaged (`deno task package`, `--compress xz`):
  a single self-contained **50 MB AppImage** with the dist embedded,
  which self-extracts to ~160 MB on first launch and passes the full
  smoke suite — vs 702 MB for the unpacked Electron build in this repo.

Caveats / gaps:

- `deno desktop` is explicitly experimental; the dev-runner compiles and
  bundles but exits without launching the app (observed with 2.9.2 on
  Linux) — run the bundled `./desktop-deno/desktop-deno` binary directly,
  which is what `run-nixos.sh` does.
- Every statement is a synchronous loopback round trip (roughly 1 ms
  each). Bulk flows (imports, becca load on large databases) would want
  request batching or a streaming protocol before this became a product.
- The `--backend cef` (bundled Chromium) option should restore real OPFS —
  untested here.
- Permission flags must be baked at compile time (see `deno.json` tasks);
  a runtime permission prompt has no TTY and silently kills the app.
- Rendering parity untested for heavy note types (canvas/Excalidraw,
  Mermaid, PDF.js) — WebKitGTK is the risk area, as with Tauri.
- The packaged AppImage still resolves WebKitGTK from the system at
  runtime (on NixOS it needs the same `LD_LIBRARY_PATH` treatment as
  `run-nixos.sh`).
- No window-state restore, spellcheck dictionaries, printing, or global
  shortcuts — Electron features with no `deno desktop` equivalent yet.
