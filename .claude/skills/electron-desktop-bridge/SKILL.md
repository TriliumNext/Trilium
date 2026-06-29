---
name: electron-desktop-bridge
description: Use when adding, changing, or debugging a `window.electronApi.*` method in the Trilium desktop app — wiring an IPC channel across the contextBridge (commons interface → preload.ts → a handler module → main.ts setup call → preload.spec.ts), choosing send/sendSync/invoke, making handlers crash-safe, or validating untrusted renderer input (fs/shell/url). Also covers triaging trilium-app:// protocol and WebContents security-boundary failures (STATUS_BREAKPOINT, (blocked:origin), SSE not streaming, blocked webview / permission / download). Note: handlers are NOT all in window.ts — they live across ~7 modules, each needing a setupX() call from main.ts, and the test is co-located at apps/desktop/src/preload.spec.ts.
---

# Electron desktop bridge (window.electronApi IPC)

The renderer has **no** Node/Electron access (`nodeIntegration:false`, `contextIsolation:true`). Every native capability crosses one contextBridge: a typed method on `window.electronApi.*` → an `ipcRenderer` call in `preload.ts` → an `ipcMain` handler in the main process. This skill is the recipe for adding one end-to-end, plus a triage table for the `trilium-app://` protocol / WebContents security boundary (a reference).

## Read this first — where things actually live

Two spots that are easy to get wrong, plus one stale pointer still baked into the source:

| Topic | Reality |
|---|---|
| Where the IPC handler goes | `window.ts` is **one of 7** handler modules — don't dump everything there. A new domain needs its **own** module + a `setupX()` call wired into `main.ts`. Use the module map below. |
| Where the test goes | **Co-located**: [`apps/desktop/src/preload.spec.ts`](../../../apps/desktop/src/preload.spec.ts) (not a top-level `spec/` dir). |
| commons docstring `electron_api_interface.ts:240` says validators live in `apps/server/src/services/shell_validators.ts` | That source file no longer exists (only stale `out-tsc` build artifacts remain). Validators are inline in [`apps/desktop/src/services/shell.ts`](../../../apps/desktop/src/services/shell.ts). |

## The #1 footgun: a new handler module is DEAD until `main.ts` calls its `setupX()`

`ipcMain.on`/`handle` only registers when the module's setup function actually runs. There is no startup error if you forget — the symptom is **silent at the source**: a `send` channel no-ops, and a `sendSync` channel **hangs the renderer forever** (synchronous IPC blocks the whole renderer process waiting for a reply that never comes). The seven setup calls + the ws provider are all invoked from one block in [`apps/desktop/src/main.ts:120-126`](../../../apps/desktop/src/main.ts) plus `ipcMessaging.init()` at `main.ts:177`. If you add a module, add the call there.

## The 5-place wiring recipe (not 4)

| # | Place | File | What goes here |
|---|---|---|---|
| 1 | **Interface** | [`packages/commons/src/lib/electron_api_interface.ts`](../../../packages/commons/src/lib/electron_api_interface.ts) | Add the method to the right sub-interface (`ElectronWindowApi`, `ElectronShellApi`, …). This is the shared contract: preload `satisfies ElectronApi`, client reads `window.electronApi`. |
| 2 | **Preload** | [`apps/desktop/src/preload.ts`](../../../apps/desktop/src/preload.ts) | Implement the method, picking the transport (table below). Must stay CJS-compilable for the sandboxed renderer. |
| 3 | **Main handler** | the correct module (map below) | Register the `ipcMain.on`/`handle`, **wrapped in try/catch** (crash-safety below). |
| 4 | **Register** | [`apps/desktop/src/main.ts`](../../../apps/desktop/src/main.ts) | Only if you made a **new** module: call its `setupX()` in the `main.ts:120-126` block. Existing modules are already wired. |
| 5 | **Test** | [`apps/desktop/src/preload.spec.ts`](../../../apps/desktop/src/preload.spec.ts) | Assert the exact `{channel, args}` the preload method emits. |

Validate: `pnpm --filter desktop test` (runs `preload.spec`, `shell.spec`, `printing.spec`, etc. via `vitest --config vitest.config.mts`). For any **fs/shell/url** channel, also add a main-process input validator — see the Security section.

## Transport decision table (send / sendSync / invoke / on)

The preload transport MUST match the handler kind, or it fails silently or hangs:

| Renderer need | preload call | main side | gotcha if mismatched |
|---|---|---|---|
| fire-and-forget, no return | `ipcRenderer.send(ch, ...args)` | `ipcMain.on(ch, (event, ...args) => {})` | sending to a `handle`-only channel = **silent no-op** |
| synchronous value (**blocks renderer**) | `ipcRenderer.sendSync(ch, arg)` | `ipcMain.on(ch, (event) => { event.returnValue = x })` | forget `event.returnValue` ⇒ **renderer hangs** (sync IPC blocks the whole renderer) |
| async value (Promise) | `ipcRenderer.invoke(ch, ...args)` | `ipcMain.handle(ch, async (event, ...args) => x)` | no `handle` registered ⇒ promise rejects `"No handler registered for '<ch>'"` |
| main → renderer push | `ipcRenderer.on(ch, (event, data) => cb(data))` + an unsub | `webContents.send(ch, data)` (**not** ipcMain) | push channels have **no** `ipcMain` handler — don't "fix" their absence |

Real examples: `sendSync` returning `event.returnValue` at `window.ts:485` (`is-maximized`); `invoke`↔`handle` pair at `shell.ts:243` (`open-path`); push via `webContents.send(IPC_TO_RENDERER, …)` at `ipc_messaging_provider.ts:57`.

**Multiplexed channel:** `navigation-history` is ONE channel serving 5 preload methods via a method-name arg + an `event.returnValue` switch (`window.ts:512-522`). The preload methods pass the method name as the first arg (`sendSync("navigation-history", "canGoBack")`, `preload.ts:216`).

## Handler-module map (where does my `ipcMain` handler go?)

The preload API **group** name does NOT map 1:1 to a handler module — infer from this table, not from the group:

| setup fn (called in `main.ts`) | module | channels it owns |
|---|---|---|
| `setupWindowing()` | `services/window.ts` | window/* (zoom, theme, title bar, full-screen, min/max, devtools, background material, lifecycle), clipboard `copy-image-to-clipboard` + `read-clipboard-text`, spellcheck `get-available-spellchecker-languages`, contextMenu `web-contents-action`, navigation/* |
| `setupShellHandlers()` | `services/shell.ts` | `open-external`, `open-path`, `open-file-url`, `download-url`, `open-custom` |
| `setupPrintingHandlers()` | `services/printing.ts` | `print-note`, `export-as-pdf`, `export-as-pdf-preview`, `save-pdf`, `get-printers`, `print-from-preview` (+ transient `print-progress`) |
| `registerSecurityIpcHandlers()` | `services/security_settings.ts` | `security-set-backend-scripting`, `security-set-sql-console` |
| `setupStartupMetricsIpc()` | `services/startup_metrics.ts` | `report-startup-metric` |
| `setupSystemTray()` | `services/tray.ts` | `reload-tray` |
| `setupCustomDictionary()` | `services/custom_dictionary.ts` | `add-word-to-dictionary` |
| `ipcMessaging.init()` | `ipc_messaging_provider.ts` | `trilium-ws-from-renderer` (the ws bridge) |

Note the splits that defeat guessing-by-group: spellcheck's `add-word-to-dictionary` is in **custom_dictionary.ts** but `get-available-spellchecker-languages` is in **window.ts**; **clipboard** handlers live in **window.ts**, not a clipboard module.

## Crash-safety (highest-severity footgun)

An unhandled throw inside an `ipcMain.on` listener crashes the **entire main process** — there is no renderer-side rejection to catch it. The verbatim warning is in [`shell.ts:276-278`](../../../apps/desktop/src/services/shell.ts). Wrap every handler body:

```ts
electron.ipcMain.on("my-channel", (_event, arg: string) => {
    try {
        const validated = validateArg(arg);
        doThing(validated);
    } catch (e) {
        getLog().error(`my-channel failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
    }
});
```

For `ipcMain.handle` whose contract is `Promise<string>`, the catch should also **return** the error string (the renderer awaits it) — see `open-path`/`open-file-url` returning `coreUtils.safeExtractMessageAndStackFromError(e)` at `shell.ts:248-249, 258-259`.

## Security: validate untrusted renderer input

The renderer is XSS-reachable, so it is **untrusted**. Every fs/shell/url channel validates in the main process and throws on violation. The five validators in [`apps/desktop/src/services/shell.ts`](../../../apps/desktop/src/services/shell.ts) are exported and unit-tested:

- `validateOpenExternalUrl` (`shell.ts:106`) — scheme allowlist `SHELL_OPEN_EXTERNAL_PROTOCOLS` (commons); blocks Follina (`ms-msdt:`/`search-ms:`), `smb:`/`ldap:` NTLM leak, `file:`/`data:`/`jar:`.
- `validateOpenPath` / `validateOpenCustomPath` (`shell.ts:78`, `:47`) — canonicalize + sandbox to data dir / tmp dir; implicitly blocks UNC + traversal; reject null bytes / nonexistent files.
- `validateOpenFileUrl` (`shell.ts:138`) — require `file:` + empty hostname (blocks `file://attacker/share` UNC NTLM leak); normalize `file://C:/` → `file:///C:/`.
- `validateDownloadUrl` (`shell.ts:178`) — same-origin lock by scheme+hostname+port (can't use `URL.origin`: the custom scheme is opaque-origin `"null"`).

Full table with threat models and the commons constants → [references/input-validators.md](references/input-validators.md).

## Debugging the protocol / WebContents boundary

When the symptom isn't a missing channel but the renderer itself failing (white screen, `STATUS_BREAKPOINT`, `(blocked:origin)`, SSE not streaming, a blocked `<webview>` / permission / download), it's the `trilium-app://` protocol or the WebContents security guard — not the IPC bridge. Symptom→cause→file table → [references/protocol-and-security-triage.md](references/protocol-and-security-triage.md).

## Reusable asset: `scripts/ipc-parity.mjs`

Direction-aware parity diff across the interface ↔ preload ↔ ipcMain handlers ↔ spec. Run it after wiring (or to audit drift):

```bash
node .claude/skills/electron-desktop-bridge/scripts/ipc-parity.mjs
```

It reports: **(a)** renderer→main channels (send/sendSync/invoke) with no `ipcMain` handler — these hang/no-op (exit code 1); **(b)** `ipcMain` handlers with no preload caller (dead/legacy — `print-note`/`export-as-pdf` are known orphans); **(c)** preload channels with no `preload.spec.ts` assertion (untested). It whitelists push-only (`ipcRenderer.on`) channels and is channel-granular so the multiplexed `navigation-history` doesn't false-positive.

## Reference map

| File | What it covers |
|---|---|
| [references/input-validators.md](references/input-validators.md) | The 5 shell validators (signatures, threat model, exact checks), `SHELL_OPEN_EXTERNAL_PROTOCOLS` derivation, `WEBVIEW_SESSION_PARTITION`, and the validator test harness. |
| [references/protocol-and-security-triage.md](references/protocol-and-security-triage.md) | Symptom→cause→file table for `trilium-app://` (`protocol.ts`) and the WebContents boundary (`web_contents_security.ts`): STATUS_BREAKPOINT/STRIPPED_HEADERS, (blocked:origin)/privileged-scheme, SSE buffering/streaming bridge, frame-origin 403, `<webview>` attach, permission denial. |
| [scripts/ipc-parity.mjs](scripts/ipc-parity.mjs) | Runnable parity checker (above). |

**Related skills:** **writing-unit-tests** (the `vi.mock("electron")` + exact-`{channel,args}` pattern that `preload.spec.ts` uses; Windows/sandbox vitest invocation); **analyzing-coverage** for chasing the new handler's coverage through the desktop suite.
