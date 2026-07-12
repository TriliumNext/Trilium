# Trilium Notes — Deno Desktop prototype

A proof-of-concept desktop app for Trilium built on [`deno desktop`](https://docs.deno.com/runtime/desktop/)
(experimental since Deno 2.9, June 2026) instead of Electron. There is no
Node.js anywhere in the resulting app.

Two modes, selected in `main.ts`:

- **native** (default): `@triliumnext/core` runs directly in a Deno process
  — "core + Deno providers". Deno imports the core TypeScript sources
  as-is (sloppy imports + pnpm's `node_modules`), SQL executes in-process
  through Deno's built-in `node:sqlite`, and the shared route table from
  core (the same one the standalone app uses) is served over loopback HTTP
  plus a WebSocket for entity-change push. The webview hosts only the
  client.
- **wasm** (`TRILIUM_WASM=1`): the untouched standalone stack (SQLite WASM +
  service worker) runs inside the webview; the Deno side serves the bundle
  and provides persistence bridges (see "WASM-mode persistence" below).

## Native architecture

```
┌─ desktop shell (compiled) ─┐   ┌─ core server (deno run) ──────────────┐
│  Deno.BrowserWindow        │   │  server/dev.ts on 127.0.0.1:<port>    │
│  ├─ navigate() ────────────┼──►│  ├─ static client bundle (standalone  │
│  ├─ bindings, tray,        │   │  │   dist, service worker disabled)   │
│  │  notifications, dock    │   │  ├─ shared API routes (BrowserRouter) │
│  └─ spawns/kills ──────────┼──►│  ├─ WebSocket (entity changes)        │
│                            │   │  └─ trilium-core + node:sqlite (WAL)  │
└────────────────────────────┘   └───────────────────────────────────────┘
```

The provider assembly is `server/core_server.ts`: Deno-native providers
(`server/sql_provider.ts` for node:sqlite, plus messaging/backup/platform/
translations in `server/providers.ts`) combined with the platform-neutral
providers reused from `apps/standalone/src/lightweight/` (CLS context, zip)
and the Node crypto provider from `apps/server` (Deno's node:crypto compat).
The database is an ordinary WAL-mode SQLite file at
`$XDG_DATA_HOME/trilium-deno-desktop/document.db` (override with
`TRILIUM_DATA_DIR`) — the same persistence model as the Electron app.

The core server runs as a child `deno run` process rather than inside the
compiled shell because the experimental desktop runtime currently hangs
when loading npm modules at runtime (verified with a minimal repro; plain
`deno run` of the same graph is fine). Once fixed upstream, the child
process collapses into the shell. `server/dev.ts` also runs standalone for
headless development: `deno task dev-server`, then open
`http://127.0.0.1:8765` in any browser.

### Module resolution (workspace-root `deno.json`)

Deno loads trilium-core's TypeScript sources directly, but two wrinkles
need a **workspace-root** `deno.json` (at the repo root, one per checkout —
inert to pnpm/Vite/tsc):

- `unstable: ["sloppy-imports"]` lets Deno load core's extensionless and
  relative `.js`→`.ts` imports. A workspace *member* config cannot set this
  field, and the CLI flag only covers relative specifiers.
- core imports a handful of sibling packages by **bare** specifier with a
  `.js` extension (`@triliumnext/commons/src/lib/…​.js`). sloppy-imports
  does not remap bare specifiers, and the import map that fixes them must
  live at the root — a member import map does not govern the imports inside
  `packages/trilium-core`. The root `deno.json` lists these explicitly.

The desktop shell binary itself has no npm/core deps (only `jsr:@std` +
`node:` builtins), so its build passes `--node-modules-dir=none`; without
that flag `deno desktop` embeds all of pnpm's `node_modules` and the binary
balloons from ~75 KB to >1 GB.

## Running

Prerequisites: Deno ≥ 2.9, `pnpm install`, and a standalone build
(`pnpm --filter standalone build`).

```sh
deno task start        # native mode: build shell + launch
deno task dev-server   # native core server headless on :8765 (no window)
deno task smoke        # self-verifying: boots, drives real setup, checks UI + WS
deno task start-wasm   # legacy wasm-in-webview mode
deno task smoke-wasm
deno task package      # experimental: self-contained AppImage (wasm mode)
```

### NixOS

The prebuilt webview backend dynamically links WebKitGTK; use the helper,
which composes an `LD_LIBRARY_PATH` from nixpkgs (needs nix-ld), builds the
bundle, and runs the resulting binary directly with logs visible:

```sh
./run-nixos.sh          # build + launch
./run-nixos.sh smoke
```

It falls back to `~/.local/share/deno29/deno` when the `deno` on PATH
predates 2.9 (nixpkgs still ships 2.8), and honors `DENO_BIN`.

## WASM-mode persistence

WebKitGTK webviews do not expose OPFS, so in wasm mode the SAHPool VFS is
unavailable and the worker would fall back to a throwaway in-memory
database. The shell therefore exposes `POST /desktop-sql`, and
`apps/standalone/src/lightweight/bridged_sql_provider.ts` implements the
synchronous `DatabaseProvider` over sync XHR against it — every statement
executes in the shell's native node:sqlite database. Probe order:
OPFS SAHPool → SQL bridge → legacy snapshot bridge (`/desktop-db`,
whole-database copies every 15 s) → in-memory. Plain static hosting fails
the probes and keeps today's browser behavior.

## Prototype findings (July 2026)

What works:

- **Core-in-Deno**: Deno imports the trilium-core TS sources directly
  (import map + sloppy imports + pnpm node_modules). The smoke test drives
  the real setup (schema + 175-note demo import through node:sqlite),
  then verifies the full client UI and a live entity-change WebSocket
  against the native core.
- WASM mode: the standalone stack boots unchanged in the webview, with
  ~23k SQL statements flowing through the sync-XHR bridge during setup.
- Native tray, notifications, dock badge, `bindings.*` bridge, devtools.
- Packaged (wasm mode, `--compress xz`): a single self-contained
  **50 MB AppImage** that self-extracts to ~160 MB on first launch —
  vs 702 MB for the unpacked Electron build in this repo.

Caveats / gaps:

- `deno desktop` is explicitly experimental. Two bugs hit here: the
  dev-runner exits without launching the app (run the bundled binary
  directly; `run-nixos.sh` does), and runtime npm loading hangs in the
  compiled runtime (hence the child-process core server).
- Native mode is dev-run oriented: the child process imports TS sources
  from the repo, so it needs the checkout + node_modules. Packaging
  native mode into a single binary is blocked on the npm-loading bug.
- Rendering parity untested for heavy note types (canvas/Excalidraw,
  Mermaid, PDF.js) — WebKitGTK is the risk area, as with Tauri.
- No window-state restore, spellcheck dictionaries, printing, or global
  shortcuts — Electron features with no `deno desktop` equivalent yet.
- Sync, protected sessions, imports/exports and scripting are untested
  in native mode (the route table and providers are in place, but only
  boot/setup/browse/edit paths were exercised).
