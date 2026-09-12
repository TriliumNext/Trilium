---
name: developing-electron-desktop
description: Use when working on the Trilium Electron desktop app (`apps/desktop`) — adding or changing an `electronApi` method / IPC channel, touching `preload.ts`, `main.ts`, `services/window.ts` or any main-process service (tray, printing, dialogs, import/export, spellcheck, autostart, security settings), the `trilium-app://` protocol, launching or debugging the desktop build, or writing tests for desktop code. Covers the process/security model, the four-file recipe for a new Electron API (plus the handler-module map, the send/sendSync/invoke transport table, ipcMain crash-safety and the shell input validators), a runnable ipc-parity checker, triage for `trilium-app://` protocol and WebContents failures (STATUS_BREAKPOINT, (blocked:origin), non-streaming SSE, blocked webview/permission), running (`pnpm desktop:start`) and the known launch errors, and how desktop specs mock `electron`.
---

# Developing the Electron desktop app

`apps/desktop` runs the **server and the client in one Electron process**: the main process boots `@triliumnext/core` + the Express app from `@triliumnext/server`, and the renderer is the ordinary `apps/client` bundle. There is no HTTP between them — see "How the renderer reaches the server" below. `apps/desktop/src/main.ts` is the entry point; `services/window.ts` creates windows and owns the window/spellcheck IPC.

## Layout

```
apps/desktop/
  src/main.ts                    # startup: platform provider, core init, Express app, windows, tray, IPC setup
  src/preload.ts                 # the ONLY bridge renderer ↔ main (contextBridge → window.electronApi)
  src/protocol.ts                # trilium-app:// scheme → dispatch into Express in-process
  src/ipc_messaging_provider.ts  # replaces the WebSocket with ipcMain/webContents.send
  src/platform_provider.ts       # DesktopPlatformProvider (isElectron, getEnv, crash)
  src/services/window.ts         # BrowserWindow creation, webPreferences, window/spellcheck/nav IPC
  src/services/*.ts              # one module per concern: tray, printing, dialog, import, export,
                                 #   restore, shell, auto_launch, backup_passphrase, security_settings,
                                 #   custom_dictionary, onenote (+ loopback_oauth), referer, request,
                                 #   startup_metrics, web_contents_security
  src/*.spec.ts, services/*.spec.ts   # vitest, `pnpm --filter desktop test`
  spec/build-checks/artifacts.spec.ts # verifies the built dist
  e2e/                           # Playwright against the built app (`pnpm --filter desktop e2e`)
  scripts/build.ts               # esbuild bundle + asset copy into dist/
  electron-forge/                # packaging (forge.config.ts, icons, dmg, portable/safe-mode launchers)
```

## Process and security model

- **`nodeIntegration: false`, `contextIsolation: true`, `webviewTag: true`** on every window (`services/window.ts`). The renderer has no Node, no `require("electron")`, no `@electron/remote` (removed — never reintroduce it). Everything crosses through the preload bridge.
- **`web_contents_security.ts`** vets every `<webview>` in `will-attach-webview` and decides `window.open`: the app shell's root URL becomes an extra window in the opener's renderer process (that is how the client opens new windows — no IPC channel), everything else is denied and allow-listed URLs are routed to the OS. If a new feature needs a popup or a webview privilege, change it there — never relax `webPreferences` at the call site.
- **Main-process handlers validate their input** and never trust a path from the renderer: OS pickers run in the main process (`dialog.ts`, `import.ts`, `restore.ts`) and hand back a location the *user* chose; `import.ts` mints single-use access grants rather than accepting a path; `shell.ts` gates every channel with a validator that throws. Follow the same shape for anything that touches the filesystem or the OS.
- **Secrets stay out of the DB where they must**: `security_settings.ts` reads `data_dir/security.json`, `backup_passphrase.ts` uses the OS keyring — the passphrase must not travel inside the backup it protects.
- **`services/request.ts`** (`ElectronRequestProvider`) uses Electron's `net` so sync honours the system proxy; `referer.ts` keeps hosts that require an http(s) `Referer` working from the `trilium-app://` origin.

## How the renderer reaches the server

- The UI loads from **`trilium-app://app/`**, a privileged custom scheme (`protocol.ts`). `registerTriliumAppScheme()` **must run before `app.ready`** (Electron ignores `registerSchemesAsPrivileged` afterwards and navigation aborts with `(blocked:origin)`); `setupTriliumAppProtocol(expressAppPromise)` installs the handler that synthesises a Node request/response and dispatches through the real Express app — session, CSRF, multer and error middleware all run. Requests arriving before the server is built simply wait on the promise. `apps/server/src/services/electron_request.ts` tags them so auth/CSRF middleware can tell them from external TCP traffic. The same two functions are reused by `apps/edit-docs`.
- **WebSocket is replaced by IPC**: `ipc_messaging_provider.ts` implements `MessagingProvider` over `webContents.send` / `ipcMain.on`, one client per `webContents.id`; the client side picks it up through `window.electronApi.ws` (`apps/client/src/services/ws.ts`). Don't open a TCP WebSocket from desktop code.
- Window creation is gated on core init, not full server startup, so the renderer spins up while Express is still building (`coreInitializedPromise` / `expressAppPromise` in `main.ts`).

## The `main()` prologue runs before the database

Everything from the top of `main()` down to `dbProvider.loadFromFile(…)` runs before `app.on("ready")` and long before `initializeCore()` wires core's SQL layer. Chromium switches (`app.commandLine.appendSwitch`, `app.disableHardwareAcceleration`) must be applied before `ready`, which forces that shape — current readers are `lang` via `getElectronLocale()`, `smoothScrollEnabled` (#10559) and `hardwareAccelerationEnabled` (#10572). Three rules hold in that window:

- **`options.getOptionOrNull()` always returns `null` there.** It falls back to `getSql()`, which throws before the provider is wired, so an option-derived switch silently takes its default (#10559). Read pre-`ready` values with `readDbOption(dbProvider, name)` instead.
- **Keep the prologue await-free.** `app`, `config` and `dataDirs` are static imports precisely so `ready` cannot fire before the database is open. Adding an `await` — including a `await import(…)` for something already statically available — reintroduces the race that lands a switch too late.
- **Open the database once.** The `BetterSqlite3Provider` the switches read from is the same instance handed to `initializeCore({ dbConfig: { provider } })`; don't open a second connection. The single-instance lock check stays *before* the open, so a second launch exits without touching the file.

## Adding an Electron API (renderer → main)

Four files, always together:

1. **Interface** — add the method to the right group interface in `packages/commons/src/lib/electron_api_interface.ts` (`ElectronWindowApi`, `ElectronShellApi`, `ElectronPrintingApi`, …; the groups are listed on `ElectronApi` at the bottom of the file, each with a one-line purpose). New concern → new `ElectronXxxApi` interface and a new key on `ElectronApi`. Doc-comment the method: the client only sees this file.
2. **Preload** — implement it in `apps/desktop/src/preload.ts` inside the matching group of the `contextBridge.exposeInMainWorld("electronApi", { … } satisfies ElectronApi)` literal. `satisfies` makes the typecheck fail until preload matches the interface. Keep the preload thin: marshal arguments to `ipcRenderer.send` / `invoke` / `sendSync`; no logic.
3. **Handler** — register the `ipcMain` handler in the service module that owns the concern (`services/shell.ts`, `services/printing.ts`, …, each with a `setupXxxHandlers()` called from `main.ts`), or in `setupWindowing()` in `services/window.ts` for window/spellcheck/navigation. Channel names are kebab-case verbs (`open-external`, `set-full-screen`, `backup-passphrase-set`). Pick the IPC style by shape:
   - `ipcMain.on(channel, handler)` — fire-and-forget (`ipcRenderer.send`);
   - `ipcMain.handle(channel, handler)` — async request/response (`ipcRenderer.invoke`);
   - `ipcMain.on` + `event.returnValue = …` — synchronous query (`ipcRenderer.sendSync`); use sparingly, it blocks the renderer.
   Main → renderer events go the other way: `webContents.send(channel, …)` in main, an `ipcRenderer.on` subscription exposed as `onXxx(callback)` in preload.
4. **Tests** — `apps/desktop/src/preload.spec.ts` (asserts the exposed API shape and that each method sends/invokes the right channel; extend the `exposedApi` assertions) and the owning service's `*.spec.ts` for the handler.

Then call it from the client as `window.electronApi?.group.method()` — always optional-chained, since the same client runs in the browser. `window.electronApi` is declared in `apps/client/src/types.d.ts`; gate desktop-only UI on `isElectron()` from `apps/client/src/services/utils.ts` (server side: `utils.isElectron`).

### A new handler module is dead until `main.ts` calls its `setupX()`

`ipcMain.on`/`handle` only registers when the module's setup function actually runs, and there is **no startup error** if you forget. The symptom is silent at the source: a `send` channel no-ops, and a `sendSync` channel **hangs the renderer forever**, because synchronous IPC blocks the whole renderer process waiting for a reply that never comes. The setup calls live in one block in `main.ts` (plus `ipcMessaging.init()` further down). Adding a module means adding the call there.

### Which module owns my channel?

The preload API *group* name does not map 1:1 to a handler module — infer from this table, not from the group:

| setup fn (called in `main.ts`) | module | channels it owns |
|---|---|---|
| `setupWindowing()` | `services/window.ts` | the bulk (~31): window lifecycle, zoom, theme, title bar, full-screen, min/max, dev tools, background material, `navigation-history*`, **clipboard** (`copy-image-to-clipboard`, `read-clipboard-text`), **spellchecker language** channels, `web-contents-action` |
| `setupShellHandlers()` | `services/shell.ts` | `open-external`, `open-path`, `show-item-in-folder`, `open-file-url`, `download-url`, `open-custom` |
| `setupPrintingHandlers()` | `services/printing.ts` | `print-note`, `export-as-pdf`, `export-as-pdf-preview`, `save-pdf`, `get-printers`, `print-from-preview`, `print-progress` |
| `registerSecurityIpcHandlers()` | `services/security_settings.ts` | `security-set-backend-scripting`, `security-set-sql-console`, `security-set-lan-access` (all three via `registerToggleHandler`) |
| `setupStartupMetricsIpc()` | `services/startup_metrics.ts` | `report-startup-metric` |
| `setupSystemTray()` | `services/tray.ts` | `reload-tray` |
| `setupCustomDictionary()` | `services/custom_dictionary.ts` | `add-word-to-dictionary` |
| `ipcMessaging.init()` | `ipc_messaging_provider.ts` | `trilium-ws-from-renderer` (the ws bridge; the channel names are the `IPC_FROM_RENDERER`/`IPC_TO_RENDERER` constants) |

Note the splits that defeat guessing by group: spellcheck's `add-word-to-dictionary` is in **custom_dictionary.ts** while the spellchecker-language channels are in **window.ts**, and the **clipboard** handlers live in **window.ts**, not a clipboard module.

### Transport must match the handler kind

Mismatch it and the failure is silent or fatal, never a clear error:

| Renderer need | preload call | main side | if mismatched |
|---|---|---|---|
| fire-and-forget, no return | `ipcRenderer.send(ch, …)` | `ipcMain.on(ch, (event, …) => {})` | sending to a `handle`-only channel is a **silent no-op** |
| synchronous value (**blocks renderer**) | `ipcRenderer.sendSync(ch, arg)` | `ipcMain.on(ch, (event) => { event.returnValue = x })` | forgetting `event.returnValue` **hangs the renderer** |
| async value (Promise) | `ipcRenderer.invoke(ch, …)` | `ipcMain.handle(ch, async (event, …) => x)` | no `handle` registered ⇒ the promise rejects `"No handler registered for '<ch>'"` |
| main → renderer push | `ipcRenderer.on(ch, cb)` + an unsubscribe | `webContents.send(ch, data)` (**not** `ipcMain`) | push channels have **no** `ipcMain` handler — don't "fix" their absence |

**Multiplexed channel:** `navigation-history` is one channel serving several preload methods via a method-name first argument and an `event.returnValue` switch.

### Crash-safety

An unhandled throw inside an `ipcMain.on` listener crashes the **entire main process** — there is no renderer-side rejection to catch it. `shell.ts` carries this warning verbatim next to `open-custom`. Wrap every handler body:

```ts
electron.ipcMain.on("my-channel", (_event, arg: string) => {
    try {
        doThing(validateArg(arg));
    } catch (e) {
        getLog().error(`my-channel failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
    }
});
```

For an `ipcMain.handle` whose contract is `Promise<string>`, the catch should also **return** the error string, since the renderer awaits it — that is what `open-path`/`open-file-url` do.

### Check the wiring with `ipc-parity.mjs`

A direction-aware parity diff across interface ↔ preload ↔ `ipcMain` handlers ↔ spec. Run it after wiring a channel, or to audit drift:

```bash
node .claude/skills/developing-electron-desktop/scripts/ipc-parity.mjs
```

It reports renderer→main channels with no handler (these hang or no-op), transport/handler-kind mismatches, handler modules whose `setupX()` is never called, handlers with no preload caller (`print-note`/`export-as-pdf` are known legacy orphans), and preload channels with no `preload.spec.ts` assertion. It whitelists push-only channels and is channel-granular, so the multiplexed `navigation-history` doesn't false-positive. Exit code 1 on a fatal finding.

## Validating untrusted renderer input

The renderer is XSS-reachable, so it is **untrusted**. Every fs/shell/url channel validates in the main process and throws on violation. The five validators in `apps/desktop/src/services/shell.ts` are exported and unit-tested:

- `validateOpenExternalUrl` — scheme allowlist from `SHELL_OPEN_EXTERNAL_PROTOCOLS` (commons); blocks Follina (`ms-msdt:`/`search-ms:`), the `smb:`/`ldap:` NTLM leak, and `file:`/`data:`/`jar:`.
- `validateOpenPath` / `validateOpenCustomPath` — canonicalize and sandbox to the data dir / tmp dir; implicitly blocks UNC paths and traversal; reject null bytes and nonexistent files.
- `validateOpenFileUrl` — require `file:` with an empty hostname (blocks the `file://attacker/share` UNC NTLM leak); normalize `file://C:/` → `file:///C:/`.
- `validateDownloadUrl` — same-origin lock by scheme + hostname + port. It cannot use `URL.origin`, because the custom scheme is opaque-origin (`"null"`).

Add a validator for any new channel that takes a path, a URL, or anything else the main process will act on.

## Strings and platform code

- Main-process user-facing text (tray menu, dialogs, error boxes) goes through `import { t } from "i18next"` with keys in `apps/server/src/assets/translations/en/server.json`. Never hardcode.
- Platform checks in main use `process.platform`; code shared with core uses `isElectron()`/`isMac()`/`isWindows()` from `@triliumnext/core` utils (functions, only after `initializeCore()`).
- The preload is compiled to **CJS** (`src/preload.compiled.cjs`, gitignored) — dev by `scripts/electron-start.mts`, prod by `apps/desktop/scripts/build.ts` — because Electron's sandboxed renderer can only load CJS preloads. Don't import ESM-only things into `preload.ts`.

## The main bundle is ESM with code splitting

`scripts/build.ts` builds `src/main.ts` with `buildBackend(..., { format: "esm" })`: the
production entry is **`dist/main.mjs`** plus lazy chunks under `dist/chunks/` (the generated
`dist/package.json` points Electron's `main` at it). The preload and `image_worker.cjs` stay
CJS — the sandboxed renderer can't load an ESM preload, and the worker is spawned by its
`.cjs` path. Three rules follow:

- **`__dirname` in bundled code means the bundle root, even inside a chunk** — the ESM banner
  in `scripts/build-utils.ts` resolves a chunk's `__dirname` one level up on purpose, because
  bundled code locates `preload.cjs`, `image_worker.cjs` and `assets/` as siblings of the
  entry. Don't "simplify" the banner, and don't path-math around it in app code.
- **Dynamically importing a CommonJS package needs the interop read**: `const mod = await
  import("cjs-pkg"); const { x } = mod.default ?? mod;`. Destructuring the namespace directly
  yields `undefined` in split ESM output, and unit tests mock past it. After adding a seam,
  run `node .claude/skills/analyzing-backend-bundle/check-dynamic-imports.mjs apps/desktop/dist`.
- A new heavy dependency belongs behind a dynamic `import()` at its (async) call site, so it
  lands in a lazy chunk instead of the startup path — measured on identical boots, ESM +
  seams took the desktop main process from 348 MB to 287 MB RSS. The
  **`analyzing-backend-bundle` skill** has the measurement tools and the seam patterns.

## Upstream Electron behaviours that bite

- **`session.setSpellCheckerLanguages()` force-enables spell check.** Upstream runs `prefs.SetBoolean(kSpellCheckEnable, !langs.empty())`, so a non-empty language list clobbers an earlier `setSpellCheckerEnabled(false)` — the symptom is spell check reactivating on every launch even though the option is off (#10569). Set the languages **first** and `setSpellCheckerEnabled(enabled)` **last**; `setupSpellcheckForSession()` and `applySpellcheckLanguages()` in `services/window.ts` both re-assert the option afterwards for this reason.
- **`electron.net` joins repeated header values with a bare comma**, where Node's `http` joins cookie arrays with `"; "` — which is why server↔server sync never hits this and desktop sync does. A `Cookie` header replayed from a raw `set-cookie` array arrives as `…HttpOnly,trilium.sid=x`, which `cookie.parse` reads as one junk key: the session cookie is lost and sync 401s with "Logged in session not found" as soon as a response carries any second `Set-Cookie` (a load-balancer affinity cookie) before Trilium's. `absorbSetCookies()` in `apps/server/src/services/request.ts` merges by name into a single `"; "`-joined string; keep any header a new `net`-based request path sends pre-joined (#10548).

## Running

| Command | What it does |
|---|---|
| `pnpm desktop:start` | dev app on port 37743, data in `apps/desktop/data`, Electron profile in `data-electron-37742`; HTTP cache disabled in dev so stale prod assets don't shadow fresh output |
| `pnpm desktop:start-prod` | `build` + run `dist/` like a release (port 37841, separate data dirs) |
| `pnpm --filter desktop electron-forge:make` / `:package` | full installers / unpacked app |
| `pnpm --filter desktop e2e` | Playwright against `dist/main.mjs` (builds first) |

Known launch-time noise and failures — do not "fix" these in app code:

- **`TypeError: Cannot read properties of undefined (reading 'commandLine')`** from `main.ts` (`app.commandLine.appendSwitch(...)`) can appear in the console of Electron-based launches (`desktop:start`, `edit-docs:edit-docs`). The app runs correctly; ignore it unless the user raises it as a bug.
- **`TypeError: Not running in an Electron environment!`** (from `electron-is-dev`) at startup means the shell inherited **`ELECTRON_RUN_AS_NODE=1`** — common inside VS Code's extension host and AI coding agents. `require("electron")` then resolves to the npm stub's path string. Unset it before launching: `unset ELECTRON_RUN_AS_NODE` (bash/zsh) or `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` (PowerShell).
- **Linux**: `gtk-version=3` and `GlobalShortcutsPortal` switches in `main.ts` are deliberate workarounds (Electron GTK 4 crash; Flatpak/Wayland global shortcuts).

## Testing desktop code

- `pnpm --filter desktop test [pattern]` — Vitest, node environment, `src/**/*.spec.ts`. Specs `vi.mock("electron", …)` and assert on the recorded `ipcMain`/`ipcRenderer` calls (see `preload.spec.ts`, `services/shell.spec.ts` for the pattern). `vitest.config.mts` sets `ELECTRON_OVERRIDE_DIST_PATH` so a dynamic `import("electron")` doesn't blow up where the binary isn't installed — don't remove it.
- The desktop suite also boots server pieces (`TRILIUM_INTEGRATION_TEST: "memory"`), so it is slower than a client spec; keep the pattern narrow.
- `spec/build-checks/artifacts.spec.ts` asserts the contents of a built `dist/` (client, assets, `better-sqlite3`, …). It is outside the default `include`, so run it explicitly (`npx vitest run --config vitest.build.config.mts`) after `pnpm desktop:build` when touching `scripts/build.ts` or the asset copies (`schema.sql`, `llm/skills`, `share-theme/templates`). Known broken as of 2026-08: it dies at *import* time — `resource_dir.ts` calls `process.exit(1)` under vitest because `TRILIUM_RESOURCE_DIR` is unset in that config — before running any assertion, with or without your changes. Fix the harness env or verify the dist by hand; don't read the failure as caused by your change.

## Debugging the protocol / WebContents boundary

When the symptom isn't a missing channel but the renderer page itself failing — white screen, `STATUS_BREAKPOINT`, `(blocked:origin)`, SSE that never streams, a blocked `<webview>`, a denied permission — the cause is `protocol.ts` or `web_contents_security.ts`, not the IPC bridge. Symptom → cause → fix table: [references/protocol-and-security-triage.md](references/protocol-and-security-triage.md).

## Reference map

| File | What it covers |
|---|---|
| [references/protocol-and-security-triage.md](references/protocol-and-security-triage.md) | `trilium-app://` and the WebContents boundary: `STRIPPED_HEADERS`/STATUS_BREAKPOINT, the privileged-scheme registration ordering, the SSE streaming bridge, the frame-origin guard and its trust model, `<webview>` attach hardening, the permission allowlist, window-open and navigation policy, the YouTube embed referer. |
| [scripts/ipc-parity.mjs](scripts/ipc-parity.mjs) | Runnable parity check across interface ↔ preload ↔ handlers ↔ spec (see above). |

Related skills: **writing-unit-tests** (the `vi.mock("electron")` pattern these specs use), **building-client-ui** (the renderer side that calls `window.electronApi`), **developing-capacitor-mobile** (the other non-browser runtime).
