---
name: developing-standalone
description: Use when working on Trilium's standalone in-browser build (`apps/standalone`, deployed at app.triliumnotes.org and embedded by the mobile app) — the service worker (`sw.ts`), the leader-tab election and multi-tab request forwarding, the SQLite worker (`local-server-worker.ts`, `@sqlite.org/sqlite-wasm` on OPFS SAHPool), the `lightweight/*` provider implementations that `initializeCore()` needs in the browser, standalone-only routes, `window.standaloneApi`, backup/restore in OPFS, the Vite bundle stubs (officeparser, pdfjs, sqlite wasm copies), startup errors, or running/testing/deploying it. Also load it when a change to `packages/trilium-core` adds a provider, a Node import, or a top-level side effect — standalone is where that breaks.
---

# Developing the standalone (in-browser) build

`apps/standalone` runs the **entire Trilium stack in the browser** with no server: the ordinary `apps/client` UI on the page, and `@triliumnext/core` — plain JS, the same code the server runs — inside a **dedicated Web Worker** on top of **SQLite compiled to WASM** (`@sqlite.org/sqlite-wasm`, not sql.js) persisted in the origin's **OPFS** through the SAHPool VFS. It ships as a PWA to **app.triliumnotes.org** (Cloudflare Pages, `deploy-app.yml`, PR previews included) and is the `webDir` of the Capacitor mobile app (`developing-capacitor-mobile` skill). There is no `apps/standalone-desktop`.

## Layout

```
apps/standalone/
  src/index.html, main.ts         # page bootstrap: SW registration, leadership claim, worker start, standaloneApi
  src/desktop.ts                  # re-exports apps/client/src/desktop — the client entry
  src/sw.ts                       # service worker: caches assets, forwards local API requests to the leader tab
  src/leader_election.ts          # Web Lock decides which tab owns the database worker
  src/local-bridge.ts             # page ⇄ worker protocol (LOCAL_REQUEST/RESPONSE, WS_MESSAGE, HTTP_REQUEST, backup/restore)
  src/local-server-worker.ts      # the worker: opens SQLite, initializeCore(), routes requests
  src/ios-interceptors.ts         # iOS Capacitor only (see mobile skill)
  src/error-overlay.ts            # full-screen surface for fatal startup failures
  src/lightweight/                # browser implementations of every core provider + standalone-only routes
  src/services/                   # image provider, Capacitor HTTP handler
  src/stubs/                      # officeparser entry + Buffer polyfill, empty stubs for pdfjs/tesseract/puppeteer
  src/test_setup.ts               # boots core with the real lightweight providers under vitest/happy-dom
  public/_headers, manifest.webmanifest, favicon.ico
  e2e/multi_tab.spec.ts, extra_window.spec.ts
  vite.config.mts                 # root is src/; aliases, stubs, asset copies, worker + SW build, vitest config
```

## Request flow

1. **`main.ts`** requires a service worker (secure context: HTTPS or localhost — otherwise it throws a message explaining that), registers `./sw.js` with scope `/`, reloads once if the SW installed but doesn't control the page yet, and exposes `window.standaloneApi` (`restore.importBackup`, `backup.downloadDatabase`) — the client's escape hatch for things carrying a whole file, the twin of desktop's `window.electronApi`.
2. **Leader election** (`leader_election.ts`): the OPFS SAHPool VFS takes *exclusive* sync-access handles, and `createSyncAccessHandle` exists only in a dedicated worker, so exactly one tab per origin can own the database. A **Web Lock** (`trilium-standalone-db`, held for the tab's lifetime) picks it; only the winner calls `startLocalServerWorker()`; when it closes the browser releases the lock and a waiting tab is promoted. Where Web Locks are missing (some WebViews) the tab assumes it is alone.
3. **Service worker** (`sw.ts`): cache-first for hashed assets, network-first otherwise; requests under `LOCAL_API_PREFIXES` (`/bootstrap`, `/api/`, `/sync/`, `/search/`, from `local-bridge.ts`) are forwarded with `LOCAL_FETCH` to the **leader** client, found via a cached id, `WHO_IS_LEADER` / `LEADER_REPLY` probing, and one retry on `NOT_LEADER` (leadership can flip while a request is in flight). Backup downloads stream over a `MessageChannel` from the leader. It must **let `/_trilium_native_http/` fall through** (Android native proxy) and has a defensive guard for `capacitor://`.
4. **The worker** (`local-server-worker.ts`): installs the SAHPool VFS (falls back to an in-memory DB when OPFS is unavailable or in `TRILIUM_INTEGRATION_TEST=memory` builds, where it seeds a fixture), calls `initializeCore({...})` with the `lightweight/*` providers, registers `createConfiguredRouter()` (`BrowserRouter` mimicking Express, path params + query strings), then answers `LOCAL_REQUEST` messages. `DbLock` (`lightweight/db_lock.ts`) serialises `createAsyncRoute` handlers (imports) that hold a transaction across `await`s against the single connection — synchronous routes keep a zero-overhead path. `WS_MESSAGE` replaces the WebSocket in both directions. Anything that escapes after startup is reported as `WORKER_ERROR` for one background task; before startup it means the app never came up and `error-overlay.ts` paints it (the async worker init is invisible to `main.ts`'s try/catch).

## The provider set (`src/lightweight/`)

`initializeCore()` takes every environment-specific capability as a provider; the browser build supplies its own for each. **A new provider or provider method in core needs an implementation here, or standalone will not boot** — the server-side one in `apps/server/src/*_provider.ts` is the pair to mirror.

| Provider | File | Notes |
|---|---|---|
| SQL | `sql_provider.ts` | wraps sqlite-wasm statements to core's `Statement` interface; SAHPool VFS install; nested transactions become SAVEPOINTs |
| Execution context (CLS) | `cls_provider.ts` | per-request context stack with a grace period for unawaited promises |
| Crypto | `crypto_provider.ts` | WebCrypto + `scrypt-js` (pure JS, slow under coverage) |
| Zip / export | `zip_provider.ts`, `zip_export_provider_factory.ts` | bytes only — no filesystem `path` source |
| Request (outbound HTTP, sync) | `request_provider.ts` (`fetch`), `bridged_request_provider.ts` (Capacitor native, via `HTTP_REQUEST` to the page) | |
| Messaging | `messaging_provider.ts` | `postMessage` in place of WS |
| Backup / restore | `backup_provider.ts`, `backup-stream.ts`, `backup-download.ts`, `database_restore.ts` | SAH pool has no rename: restore writes the new DB beside the old one and swaps the *pointer* the next start opens; stale pool entries from interrupted backups are swept |
| Setup marker | `setup_marker.ts` | `setup.json` in the origin's private FS, read **before** the DB is opened; a page reload is "restart" here |
| Platform | `platform_provider.ts` | `?safeMode` → `TRILIUM_SAFE_MODE` etc.; `isElectron/isMac/isWindows` false |
| Translations | `translation_provider.ts` | i18next in the worker with `ns: "server"`, fetching `server-assets/translations/{{lng}}/server.json` |
| In-app help | `in_app_help_provider.ts` | pre-built `assets/help_meta.json` from edit-docs; the User Guide itself is **not** in this build |
| Log | `log_provider.ts` | OPFS log file |
| Image | `services/image_provider.ts` | format sniffing only, no resize/compression |
| LLM | `llm_skills.ts` | this build's half of the LLM stack (`registerStandaloneLlmExtensions`), dynamically imported so skill sheets don't join the startup bundle |

Standalone-only routes (integrity checks, the LLM channel, upload handling that arrives as a buffer instead of a temp file) are registered in `lightweight/browser_routes.ts`; everything else is core's shared route table (`adding-internal-api-route` skill).

## Bundle discipline (`vite.config.mts`)

The worker's top-level imports **are** its startup cost — prefer dynamic imports for anything not needed to answer `/bootstrap` (the LLM skills and restore paths already do this).

- `officeparser` is aliased to `src/stubs/officeparser_entry.ts`, which loads the package's Node ESM entry plus the `buffer` polyfill (`buffer_polyfill.ts`, must be imported first) instead of the prebuilt browser monolith that inlines pdfjs (2.7 MB → 0.4 MB); `pdfjs-dist`, `tesseract.js`, `puppeteer` are aliased to `stubs/empty.ts`. `office_preview.spec.ts` guards the alias against upstream layout changes.
- `@sqlite.org/sqlite-wasm` and `@triliumnext/core` are excluded from `optimizeDeps`; the sqlite `.wasm` and OPFS async proxy are copied **unhashed** so the worker can resolve them by convention; `apps/server/src/assets/**` (minus the User Guide) is copied to `server-assets/`.
- The service worker keeps a stable `sw.js` URL (registering a hashed one would orphan the old worker); everything else under `src/` is content-hashed. `public/_headers` matches: `immutable` for `/src/*`, `must-revalidate` for `/sw.js`, plus `Cross-Origin-Opener-Policy: same-origin`.
- Vite `root` is `src/`, `base` is `""` — paths in config and coverage globs resolve relative to `src/`.

### Where a dynamic import actually splits — and where it does nothing

Core is not code-split the way its module layout suggests. Rollup folds the `packages/trilium-core` modules into a **single ~2 MB chunk** (named after an arbitrary constituent, e.g. `abstract_provider-<hash>.js`) that ~33 core modules — `becca_loader`, `browser_routes`, `crypto_provider`, the migrations — import statically, and the worker pulls in at startup. Anything reachable from that graph lands in the eager chunk no matter how the leaf that uses it imports it.

So converting a static `import` to `await import()` **inside a core module** often defers nothing. Lazy-loading `sax` in `enex.ts` produced a **byte-for-byte identical** standalone bundle — same chunk content hash, same total — because `sax` was reachable statically elsewhere in the eager graph. The prediction that it would save ~12–15 KB came from reasoning by analogy to another module; it did not survive an A/B build, and was reverted.

It is not a universal no-op, though. `await import("officeparser")` inside `services/office_preview.ts` **did** split out (`officeparser.browser-<hash>.js`, ~2.6 MB, fetched lazily), because nothing else in the eager graph imported officeparser — that one dynamic import was the dep's only path in.

The rule: a dynamic import inside core splits a dep out **only if the dep has no other static importer in the core graph**. Deferring at the route or service boundary (the `import.ts` route that statically imports `enex.js`) is the reliable lever. Either way, confirm with an A/B build — compare chunk hashes and `grep` the built output for a real `import(` — and don't bother at all for a ~40 KB dep inside a chunk that always loads.

## Running

```bash
pnpm standalone:start                                # vite dev
pnpm --filter standalone build                       # dist/ (needs NODE_OPTIONS=--max-old-space-size=4096, set by the script)
pnpm --filter standalone start-prod                  # build + vite preview on :8888
TRILIUM_INTEGRATION_TEST=memory pnpm --filter standalone build   # in-memory DB seeded from a fixture (what e2e uses)
pnpm --filter standalone e2e                         # Playwright: multi-tab leader handoff, extra windows
```

`?safeMode` and other `TRILIUM_*` toggles are passed as URL query parameters (`platform_provider.ts`).

## Testing

`pnpm --filter standalone test <pattern>` — Vitest, happy-dom, **real sqlite-wasm**. `test_setup.ts` shims wasm loading (happy-dom's `fetch` refuses `file://` and its `Response` breaks `instantiateStreaming`) and boots core with the real lightweight providers, so a spec exercises the same code path as the browser. `local-server-worker.ts` is excluded from coverage on purpose (it boots a second core). This suite is also the **second runtime for every `packages/trilium-core` spec** — green under `pnpm --filter server test` is not proof; the cross-runtime traps (capability gaps, provider differences, `serialize()`, backup) are in the `writing-unit-tests` skill.
