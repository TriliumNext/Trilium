---
name: developing-capacitor-mobile
description: Use when working on the Trilium mobile app (`apps/mobile`, Capacitor for Android/iOS) or on the standalone code paths that only run inside it — request routing on `capacitor://` vs `https://localhost`, the iOS fetch/XHR/image/stylesheet interceptors, the Android native streaming HTTP proxy (`TriliumWebViewClient`), the `NativeHttpHandler` sync transport, downloads and exports (the WebView saves none itself — `capacitor_download.ts` writes them and opens the share sheet), `MainActivity`/`ViewController` WebView tweaks (edge-to-edge, keyboard), `isMobileApp()` gating in the client, adding a Capacitor plugin, or the mobile CI/nightly builds. Also load it when reviewing a diff that touches these files, so working iOS-only code is not flagged as dead.
---

# Developing the Capacitor mobile app

`apps/mobile` is a **Capacitor shell around the standalone build**: it ships no web assets of its own — `webDir` in `capacitor.config.json` is `../standalone/dist`, and the entire Trilium server runs **in-process as WASM in a web worker** (`apps/standalone`). There is no network backend inside the app; "the server" is `apps/standalone/src/local-server-worker.ts`. Most mobile work therefore lands in `apps/standalone/src/`, with the native projects (`apps/mobile/android/`, `apps/mobile/ios/`) touched only for WebView behaviour.

Key files:

```
apps/mobile/capacitor.config.json          # appId org.triliumnotes.trilium, androidScheme https, hostname localhost, plugins
apps/mobile/android/app/src/main/java/org/triliumnotes/trilium/
    MainActivity.java                      # installs TriliumWebViewClient + TriliumFileSink, edge-to-edge + insets, system bars
    TriliumWebViewClient.java              # streaming same-origin HTTP proxy for the sync worker (Android only)
    TriliumFileSink.java                   # binary file-write channel (WebMessageListener + ArrayBuffer, Android only)
apps/mobile/ios/App/App/ViewController.swift   # keyboard handling: pins outer scroll, drives --tn-keyboard-gap
apps/standalone/src/main.ts                # boot: registers native HTTP handler if `Capacitor` in window; iOS interceptors
apps/standalone/src/ios-interceptors.ts    # fetch / XHR / <img> / stylesheet interceptors, iOS only
apps/standalone/src/services/capacitor_http_handler.ts   # NativeHttpHandler: Android proxy probe + CapacitorHttp fallback
apps/standalone/src/services/capacitor_download.ts       # saveUrlToDevice(): fetch → Filesystem cache → share sheet
apps/standalone/src/local-bridge.ts        # LOCAL_API_PREFIXES, localFetch(), registerNativeHttpHandler()
apps/standalone/src/sw.ts                  # service worker routing (Android + web); guards for capacitor:// and the native proxy
apps/client/src/services/utils.ts          # isMobileApp() — running inside the native wrapper
.github/workflows/mobile.yml, .github/actions/build-mobile   # APK + iOS simulator builds, nightly signing
```

## Inbound: how the client's API calls reach the in-app worker

The client's `/api`, `/sync`, `/bootstrap`, `/search` requests (`LOCAL_API_PREFIXES` in `local-bridge.ts`) must be answered by the worker.

**Most of them never leave the page.** The shell is a single WebView, so its one tab always wins the database lock, and a tab that owns the worker publishes `localFetch` on `window.standaloneApi`; the client's `ajax()` and `setupGlob()`'s `/bootstrap` call it directly rather than issuing a request (see the standalone skill, "Request flow" step 3). That covers everything routed through `apps/client/src/services/server.ts`, on both platforms alike.

What still leaves the page — engine-initiated loads (`<img src="api/images/…">`, `@font-face`, themes), `upload()`/`chunked_upload.ts`, the LLM stream — is where the platforms diverge, because their WebViews resolve `*Scheme: "https"` differently:

- **Android** — `androidScheme: "https"` works, the app runs at `https://localhost`, a real secure origin, so the **service worker** (`sw.ts`) intercepts those requests and forwards them to the worker — the same path as the web build.
- **iOS** — the app runs at **`capacitor://localhost`**, and WebKit refuses to register a service worker on a non-HTTP(S) origin. `main.ts` therefore installs **in-page interceptors** (`installIosInterceptors()`, gated on `location.protocol === "capacitor:"`), one per way a request can leave the page: `window.fetch`, `XMLHttpRequest` (jQuery `$.ajax` never touches fetch), `<img src="api/images/…">` (the image loader issues its own requests) and CSS-initiated loads (`@font-face url()` in injected styles, custom themes via `<link href="api/…">`). Each rewrites a local-API request into `localFetch()`.

Consequences that keep tripping people up:

- **`iosScheme: "https"` is a no-op — do not re-add it.** Capacitor rejects it: `CAPInstanceDescriptor.normalize()` checks `WKWebView.handlesURLScheme(scheme) == false`, and WKWebView reserves `http`/`https`, so the scheme resets to `capacitor`. The config line only implies an https origin that never exists on iOS.
- **Do not delete the iOS interceptor path as "dead code"**, and do not gate anything on "there is always a service worker". A reviewer assuming `iosScheme: https` ⇒ https origin will wrongly flag it.
- A **new way for the page to issue a request** (a new element type loading `api/…`, a `new Worker` fetching, `EventSource`, `sendBeacon`) needs a fourth/fifth interceptor in `ios-interceptors.ts`, or it will silently 404 on iOS while working everywhere else. Test it in `ios-interceptors.spec.ts`.
- `sw.ts` has a defensive `self.location.protocol === "capacitor:"` guard and must **let `/_trilium_native_http/` requests fall through** to the WebView (see below); keep both when editing its fetch handler.
- Image blob URLs created by the interceptor are revoked (`5332cee3fb`); if you add another `URL.createObjectURL`, revoke it.

## Outbound: how the worker syncs with a remote server

A fetch from the app origin to a sync server is cross-origin, so CORS and cookie rules apply and large bodies cost bridge copies; instead `local-bridge.ts` exposes `registerNativeHttpHandler()`: when a handler is registered (only inside Capacitor — `main.ts` checks `"Capacitor" in window`), the worker's `BridgedRequestProvider` posts `HTTP_REQUEST` messages to the page and the handler does the real HTTP call. `capacitor_http_handler.ts` is that handler:

- **Android** — probes `GET /_trilium_native_http/ping` once; if `TriliumWebViewClient` answers with the `x-trilium-native-http` marker, GET/HEAD requests go through the **streaming same-origin proxy** (`/_trilium_native_http/fetch?url=…`, request headers tunnelled as `x-trilium-h-<name>`, upstream `Set-Cookie` re-exposed as `x-trilium-set-cookie`, proxy failures → 502 + `x-trilium-proxy-error`). Answered from `WebViewClient.shouldInterceptRequest`, so the body streams into the page with no bridge envelope, no full-body Java string, no base64 — the plugin transport measured ~60 % of a core and ~2 MB/s during an initial sync. A failed probe is retried after 15 s because an old service worker can still own fetches right after an update.
- **Everything else** (POSTs, binary responses, and all of iOS) uses the stock **`CapacitorHttp` plugin**, reached via the global `window.Capacitor.Plugins` — **not** `import "@capacitor/core"`, since bare specifiers don't resolve in the browser's native module loader.
- Responses hand **parsed JSON through `data`** and only non-JSON through `body`; the handler must not `JSON.stringify` — the extra string copy OOM-ed the iOS worker on large blobs. Preserve that contract when touching either side.
- iOS has no `shouldInterceptRequest` equivalent for https, so it stays on the plugin transport; the geo map's tile referer workaround (`apps/client/src/widgets/collections/geomap/map.tsx`) has the same limitation.

## Downloads: the WebView has no download manager

A navigation whose response carries `Content-Disposition: attachment` is handed to
`WebView.setDownloadListener` on Android, and **nothing registers one** — not Capacitor, not
`MainActivity`. The response is dropped with no console output and no error, so an export "succeeds"
(the task's websocket `taskSucceeded` still fires the toast) while no file ever appears. On iOS the
same `window.location.href` is worse: the interceptors patch `fetch`/XHR/`<img>`/stylesheets, never a
top-level navigation, so the URL reaches Capacitor's scheme handler and navigates the app out of the
SPA.

Registering a native `DownloadListener` does not fix it. The listener receives only a URL, and a
native re-request of `https://localhost/api/…` goes to the real network stack, which the service
worker never sees and where no server exists.

So the page does the saving: `open.download()` (`apps/client/src/services/open.ts`) routes through
`window.standaloneApi.save.saveUrl()` when that exists, which `main.ts` defines only inside the shell.
`capacitor_download.ts` fetches the URL — still routed to the worker by the service worker on Android
and the interceptors on iOS — writes it into `Directory.Cache` and hands the file to the system share
sheet.

- **On Android the bytes ride `TriliumFileSink`, not the plugin bridge.** Every plugin call crosses
  as base64 inside a JSON string that `MessageHandler` re-parses whole with `org.json` — ~13 MB/s no
  matter the chunk size. The sink is a `WebViewCompat.addWebMessageListener` object
  (`window.triliumFileSink`) carrying raw `ArrayBuffer`s: the page resolves the absolute path via the
  Filesystem plugin's own mapping (`writeFile("")` + `getUri`), then streams `open`/chunks/`close`,
  each step acknowledged. The base64 plugin path stays as the fallback — iOS (`messageHandlers`
  cannot carry ArrayBuffers), WebViews without `WEB_MESSAGE_ARRAY_BUFFER`, and the sink-busy case.
- **Fallback chunks must be a multiple of 3 bytes.** The Filesystem plugin takes base64, and base64
  pads any group narrower than three bytes; a padded group mid-file decodes to the wrong bytes.
  `rechunk()` in `capacitor_download.ts` owns that alignment (and bounds sink messages); the encode
  uses native `Uint8Array.prototype.toBase64` when the runtime has it.
- **Plugins come from `Capacitor.registerPlugin(name)`, not a `@capacitor/*` import.** `Capacitor.Plugins`
  holds only what the injected runtime registered (`CapacitorHttp` and the rest of core); the `@capacitor/*`
  packages exist so `cap sync` wires the **native** code in.
- **A shared file cannot be deleted after `share()` resolves** — the receiving app reads the URI on its
  own schedule (a Drive upload can outlive the sheet by minutes). Each download therefore lands in a
  run folder of its own, and a save prunes all previous runs *except the newest*, giving the last
  share one save's grace.
- **Every save writes `<name>.part` and renames into place on success.** A stream can die mid-way —
  `DatabaseChangedError` fires if any write lands during a backup — and truncating the final name
  first would turn the previous good backup into a partial file.
- **Android needs no manifest change**: `file_paths.xml` already exposes `<cache-path path="."/>` to the
  `${applicationId}.fileprovider` the Share plugin looks up, and the cache directory is not external
  storage, so no permission prompt.
- **Adding a plugin means three edits**: `apps/mobile/package.json`, `includePlugins` in
  `capacitor.config.json` (iOS only builds what is listed), and `cap update android` to regenerate the
  tracked `capacitor.settings.gradle` / `app/capacitor.build.gradle`. iOS's `CapApp-SPM/Package.swift`
  is gitignored and regenerated by CI.
- **The known cost profile** (1.8 GB backup on a mid-range phone, Sept 2026): ~16s, split evenly
  between SQLite page reads and the container's WASM SHA-256 (`hash-wasm` in
  `packages/trilium-backup-container/src/backend-web.ts`); the sink's writes are not a factor. The
  base64 plugin bridge caps around 13 MB/s (`MessageHandler` re-parses each call's JSON whole with
  `org.json`), which is why the sink exists.
- **The database backup takes the same last step, from a different source.** `saveDatabase()` in
  `local-bridge.ts` consumes the worker's `BACKUP_STREAM` channel in the page rather than relaying the
  port to the service worker, so no SW is involved (which is also why it works on iOS), and
  `setBackupPinging` stays off — that keepalive exists only for a stream the SW is holding open.
  Two things differ from a download: it goes to `Directory.Documents` under `Trilium/`, not the cache,
  and nothing there is ever pruned — a repeated name replaces the file only via the `.part` swap. A
  dismissed share sheet is `done`, not `cancelled`: the file is complete before the sheet opens.
- **`rechunk()` is what makes any source safe to write.** A producer picks its chunk sizes for its own
  reasons — a response body by packet, the backup by database page — and neither is 3-aligned.

## Native shells

- **Android `MainActivity`**: sets `TriliumWebViewClient`, draws edge-to-edge with transparent system bars, forwards window insets to the WebView (so the client can pad for the status/navigation bars) and re-applies system bar appearance on configuration change. Nightly and debug builds get a distinct `applicationId` suffix (`.nightly`, `.debug`) and launcher icon so they install side by side (`android/app/build.gradle`).
- **iOS `ViewController`**: the layout is `body { position: fixed; height: 100vh }` with an inner scrolling container, so WKWebView's reflexive scroll-to-focused-element would drag the toolbar off-screen; the controller pins the outer scroll offset while the keyboard animates and samples the keyboard's top edge every frame into the `--tn-keyboard-gap` CSS variable so the editor toolbar follows an interactive swipe-dismiss. `Keyboard.resize: "native"` in the config is part of the same contract. Change the keyboard/toolbar CSS on the client and this controller together.
- `limitsNavigationsToAppBoundDomains: true` on iOS.

## Safe-area insets: never write a bare `env(safe-area-inset-*)`

Android's WebView does not populate `env(safe-area-inset-*)` — it resolves to `0`, silently, on every
Android version. `MainActivity.forwardInsetsToWebView()` works around it by setting
`--safe-area-inset-top`/`-bottom`/`-left`/`-right` (plus `--keyboard-height`) on
`document.documentElement` from the real `WindowInsetsCompat` values, in CSS pixels, on every inset
change.

**So client CSS must read the variable with `env()` only as the fallback:**

```css
padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom));
```

The fallback is what keeps iOS and desktop browsers right, where the variable is never injected and
`env()` is authoritative. Get the two axes matching — `var(--safe-area-inset-left, env(safe-area-inset-left))`,
never a `-left` var falling back to `env(…-right)`.

- **Bare `env()` is a bug on Android, not a style nit.** It had gone unnoticed at 27 call sites
  (fixed in `a8f4e9f405`), including `--mobile-bottom-offset`, which puts the mobile launcher bar
  under the gesture pill.
- **The one deliberate exception** is the `body.ios` `--mobile-bottom-offset` override in
  `apps/client/src/stylesheets/style.css` — platform-scoped to where `env()` is the real source.
- **`body.desktop` rules are in scope too.** An Android tablet WebView has no `Mobi` in its UA, so
  `isMobile()` is false and `index.ts` picks the desktop layout for it.
- **`--keyboard-height` is injected but read by nothing.** `MainActivity` resizes the WebView through
  `bottomMargin` instead, so the CSS viewport shrinks on its own. iOS drives `--tn-keyboard-gap` from
  `ViewController` for a different purpose; the two are not a pair.

Audit with `grep -rn "env(safe-area" --include=*.css apps/client/src apps/standalone/src` — every hit
should be wrapped in a matching `var()`.

## Client-side gating

- `isMobileApp()` (`apps/client/src/services/utils.ts`) — `window.Capacitor?.isNativePlatform?.()`: true only inside the native wrapper. Distinct from `isMobile()`, which is the *layout* choice and is also true for a phone browser. Use the former for "there is a native shell" behaviour (e.g. setup flow), the latter for responsive UI. `window.Capacitor` is typed in `apps/client/src/types.d.ts`.
- There is no Node, no server process and no `apps/server` code at runtime — anything the mobile app needs from "the backend" is core (`packages/trilium-core`), which is why core carries the no-Node-built-ins rules.

## Building and running

```bash
pnpm --filter @triliumnext/mobile build          # = standalone build → apps/standalone/dist
pnpm --filter @triliumnext/mobile sync           # build + `cap sync` (copies dist into android/ and ios/)
pnpm --filter @triliumnext/mobile run:android    # emulator/device (needs ANDROID_HOME, JDK 17+)
pnpm --filter @triliumnext/mobile open:android   # Android Studio
pnpm --filter @triliumnext/mobile run:ios | open:ios   # Xcode (macOS)
```

CI: `mobile.yml` (pull requests) builds a debug APK via `.github/actions/build-mobile` and an unsigned iOS **Simulator** `.app` on macOS; `nightly.yml` calls the same action with `nightly: "true"` for the signed `assembleRelease` build under the `.nightly` app id. Neither runs unit tests — those live in the standalone suite.

**Debugging on a device:** a *release*-type build (what `nightly.yml` produces) suppresses WebView
console→logcat forwarding, so anything logged from JS is invisible to `adb logcat` and log-based
detection of what the app is doing goes blind. `android.util.Log` calls from the native side still
come through, so instrument the Java layer — or install a debug build — when you need to see what
is happening.

## Testing

Everything JS-side is under the standalone Vitest suite (happy-dom + real sqlite-wasm):

```bash
pnpm --filter standalone test ios-interceptors        # iOS interceptors
pnpm --filter standalone test capacitor_http_handler  # Android proxy probe / plugin fallback
pnpm --filter standalone test capacitor_download      # chunked base64 write, filename parsing, share sheet
pnpm --filter standalone test sw                      # service-worker routing incl. capacitor:// guard
pnpm --filter standalone test main                    # boot wiring (native handler registered, interceptors installed on capacitor:)
```

Simulate the platform in a spec by stubbing `location.protocol` / `window.Capacitor` (`getPlatform`, `isNativePlatform`, `Plugins.CapacitorHttp`) — see the existing specs for the fixtures. Native Java/Swift has no test harness in the repo; keep logic there minimal and mirror the protocol on the JS side where it is testable.
