---
name: developing-capacitor-mobile
description: Use when working on the Trilium mobile app (`apps/mobile`, Capacitor for Android/iOS) or on the standalone code paths that only run inside it — request routing on `capacitor://` vs `https://localhost`, the native request bridges on both platforms (`TriliumRequestBridge` in Java and Swift, `native-request-bridge.ts`, which replace the service worker there; the iOS one re-types Capacitor's `capacitor://` scheme handler), the Android native streaming HTTP proxy (`TriliumWebViewClient`), the `NativeHttpHandler` sync transport, downloads and exports (the WebView saves none itself — `capacitor_download.ts` writes them and opens the share sheet), `MainActivity`/`ViewController` WebView tweaks (edge-to-edge, keyboard), `isMobileApp()` gating in the client, adding a Capacitor plugin, or the mobile CI/nightly builds. Also load it when reviewing a diff that touches these files, so working iOS-only code is not flagged as dead.
---

# Developing the Capacitor mobile app

`apps/mobile` is a **Capacitor shell around the standalone build**: it ships no web assets of its own — `webDir` in `capacitor.config.json` is `../standalone/dist`, and the entire Trilium server runs **in-process as WASM in a web worker** (`apps/standalone`). There is no network backend inside the app; "the server" is `apps/standalone/src/local-server-worker.ts`. Most mobile work therefore lands in `apps/standalone/src/`, with the native projects (`apps/mobile/android/`, `apps/mobile/ios/`) touched only for WebView behaviour.

Key files:

```
apps/mobile/capacitor.config.json          # appId org.triliumnotes.trilium, androidScheme https, hostname localhost, plugins
apps/mobile/android/app/src/main/java/org/triliumnotes/trilium/
    MainActivity.java                      # installs TriliumRequestBridge, TriliumWebViewClient, TriliumFileSink; edge-to-edge + insets, system bars
    TriliumRequestBridge.java              # Android adapter for LocalRequestBroker: message listener, evaluateJavascript, page reloads
    LocalRequestBroker.java                # local API request logic in place of a service worker; no Android classes, unit-tested
    NativeHttpProxy.java                   # the sync worker's streaming HTTP proxy; no Android classes, unit-tested
    InterceptedResponse.java               # Android-free form of WebResourceResponse, returned by both
    TriliumWebViewClient.java              # routes requests to TriliumRequestBridge and NativeHttpProxy, builds the WebResourceResponse
    TriliumFileSink.java                   # binary file-write channel (WebMessageListener + ArrayBuffer, Android only)
apps/mobile/ios/App/App/ViewController.swift   # re-types the capacitor:// scheme handler; keyboard handling, --tn-keyboard-gap
apps/mobile/ios/App/App/TriliumRequestBridge.swift   # WebKit adapter: TriliumAssetHandler, script message handler, WebKitSchemeTask
apps/mobile/ios/RequestBroker/             # Swift package: RequestBroker.swift (request logic, no WebKit; the App target compiles it) + its tests
apps/standalone/src/main.ts                # boot: native HTTP handler and native request bridge if `Capacitor` in window, else the SW
apps/standalone/src/native-request-bridge.ts   # page side of both TriliumRequestBridges: localFetch() → head + chunks
apps/standalone/src/services/capacitor_http_handler.ts   # NativeHttpHandler: Android proxy probe + CapacitorHttp fallback
apps/standalone/src/services/capacitor_download.ts       # saveUrlToDevice(): fetch → Filesystem cache → share sheet
apps/standalone/src/local-bridge.ts        # LOCAL_API_PREFIXES, localFetch(), registerNativeHttpHandler()
apps/standalone/src/sw.ts                  # service worker routing (web; Android only on a WebView without message listeners)
apps/client/src/services/utils.ts          # isMobileApp() — running inside the native wrapper
.github/workflows/mobile.yml, .github/actions/build-mobile   # APK + iOS simulator builds, nightly signing
```

## Inbound: how the client's API calls reach the in-app worker

The client's `/api`, `/sync`, `/bootstrap`, `/search` requests (`LOCAL_API_PREFIXES` in `local-bridge.ts`) must be answered by the worker.

**Most of them never leave the page.** The shell is a single WebView, so its one tab always wins the database lock, and a tab that owns the worker publishes `localFetch` on `window.standaloneApi`; the client's `ajax()` and `setupGlob()`'s `/bootstrap` call it directly rather than issuing a request (see the standalone skill, "Request flow" step 3). That covers everything routed through `apps/client/src/services/server.ts`, on both platforms alike.

What still leaves the page — engine-initiated loads (`<img src="api/images/…">`, `@font-face`, themes, media, iframes such as the PDF viewer) — goes to a **native request bridge** on both platforms; neither registers a service worker. Uploads stay in the page too: `uploadForm()` and the editor's image upload adapter (`packages/ckeditor5/src/plugins/uploadimage.ts`, via `glob.getLocalUpload()`) hand the `File` to `standaloneApi.localUpload`. So does AI chat: on standalone `streamChatCompletion()` posts `llm-chat/stream-start` through `server.post` and receives the reply over the WebSocket channel, never the SSE route. The native side sees every request the engine issues, whichever subsystem issued it, and hands local API paths to the page: it calls `window.__triliumNativeRequest()`, `native-request-bridge.ts` answers from `localFetch()`, and the reply comes back as JSON strings: a `head`, the body in chunks, then `end`/`error`. Where the platforms differ is how the request is caught and how the body travels:

- **Android** (`https://localhost`) — `TriliumWebViewClient.shouldInterceptRequest` hands local paths to **`TriliumRequestBridge.java`** (logic in `LocalRequestBroker`). Replies come over the injected `window.triliumRequestBridge` WebMessageListener, the body as ArrayBuffer frames (4-byte request id + bytes; base64 `chunk` messages on a WebView without ArrayBuffer messages). The IO thread blocks until the head arrives (270 s cap, as in `sw.ts`), then the body streams through a queue-backed `InputStream`. A WebView without `WEB_MESSAGE_LISTENER` never gets the object, so `installNativeRequestBridge()` returns false and the page falls back to the service worker.
- **iOS** (`capacitor://localhost`, where WebKit refuses a service worker) — `ViewController.webView(with:configuration:)` re-types Capacitor's registered `WebViewAssetHandler` to **`TriliumAssetHandler`** with `object_setClass` (WebKit raises on registering a second handler for a scheme, and Capacitor's `loadView()` is not overridable), which hands local paths to **`TriliumRequestBridge.swift`**. Replies come over the `window.webkit.messageHandlers.triliumRequestBridge` script message handler, the body always in base64 chunks (script messages cannot carry ArrayBuffers). Nothing blocks: the `WKURLSchemeTask` is completed by `didReceive(response)`, `didReceive(data)` per chunk and `didFinish()`. A main-document request through the handler counts as a page start and fails whatever the previous page left unanswered.

Consequences that keep tripping people up:

- **`iosScheme: "https"` is a no-op — do not re-add it.** Capacitor rejects it: `CAPInstanceDescriptor.normalize()` checks `WKWebView.handlesURLScheme(scheme) == false`, and WKWebView reserves `http`/`https`, so the scheme resets to `capacitor`. The config line only implies an https origin that never exists on iOS.
- **`TriliumAssetHandler` must not declare stored properties.** The instance it takes over was allocated as a `WebViewAssetHandler`, so subclass storage would be uninitialized; state lives in `TriliumRequestBridge.shared`. A stopped `WKURLSchemeTask` must never be completed (it raises), which is why `stop` removes the task from the pending map at once.
- **Both bridges answer GET and HEAD only.** Android's `shouldInterceptRequest` exposes no request body, and iOS follows suit (its scheme task could read `httpBody`) so the platforms stay alike; any other method gets a 405 with `x-trilium-bridge-error`. A request with a body has to go through `standaloneApi.localFetch` (as `server.ts`'s `ajax()` does) or, for a multipart upload, `standaloneApi.localUpload` (as `uploadForm()` does for `upload()` and imports); a raw `fetch`/`$.ajax` POST to `api/` fails on both platforms.
- **Neither native response carries a 3xx** (`WebResourceResponse` rejects one, a scheme task cannot redirect), so `native-request-bridge.ts` turns a redirect (the share pages issue them) into a 200 page with a `<meta http-equiv="refresh">`. It also sets `content-length` to the exact body length (except for HEAD), which WebKit's media loader needs.
- **Android WebView applies a request's `Range` to the intercepted stream itself.** Chromium's `AndroidStreamReaderURLLoader` treats the `InputStream` as the whole resource and skips `first_byte_position` bytes before reading, while keeping our status and headers. The worker has already cut the `206` slice, so `LocalRequestBroker` reads the start from its `Content-Range` and `ChunkStream.skip()` passes over that many bytes without reading. Without it every range past byte 0 lands in the wrong place or runs off the end (`ERR_REQUEST_RANGE_NOT_SATISFIABLE`), which breaks seeking and any MP4 whose `moov` index sits at the end. Keep `available()` at 0: that is what makes Chromium skip its own bounds check.
- **Standalone caps `bytes=N-` media responses at 8 MiB** (`maxOpenRangeLength` in `serveContentWithRanges()`, set by `openPartialInt()` when `getPlatform().isStandalone`), because each response is buffered whole on the page and copied through the bridge. The element asks for the next range on its own; ranges with an explicit end are served as asked.
- **Three prefix lists must agree**: `isLocalApiRequest()` in `local-bridge.ts`, `LocalRequestBroker.isLocalPath()` in Java and `isLocalApiPath()` in Swift, including the `/share` rule.
- **A service worker registered by an older Android build still controls the page.** Its fetches never reach `shouldInterceptRequest`, and with no `attachServiceWorkerBridge()` nothing answers them — a custom theme silently stops applying (#12170), images hang. `removeStaleServiceWorkers()` in `main.ts` unregisters it once the native bridge is installed and reloads if it was controlling. Never advise clearing the app's data: that deletes the OPFS database.
- `sw.ts` has a defensive `self.location.protocol === "capacitor:"` guard and must **let `/_trilium_native_http/` requests fall through** to the WebView (see below); keep both when editing its fetch handler.

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
same `window.location.href` is worse: it is a top-level navigation, so it takes the app out of the
SPA.

Registering a native `DownloadListener` does not fix it. The listener receives only a URL, and a
native re-request of `https://localhost/api/…` goes to the real network stack, which
`shouldInterceptRequest` never sees and where no server exists.

So the page does the saving: `open.download()` (`apps/client/src/services/open.ts`) routes through
`window.standaloneApi.save.saveUrl()` when that exists, which `main.ts` defines only inside the shell.
`capacitor_download.ts` fetches the URL — still routed to the worker by the native request bridge —
writes it into `Directory.Cache` and hands the file to the system share sheet.

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

- **Android `MainActivity`**: installs `TriliumRequestBridge` and sets `TriliumWebViewClient`, draws edge-to-edge with transparent system bars, forwards window insets to the WebView (so the client can pad for the status/navigation bars) and re-applies system bar appearance on configuration change. Nightly and debug builds get a distinct `applicationId` suffix (`.nightly`, `.debug`) and launcher icon so they install side by side (`android/app/build.gradle`).
- **iOS `ViewController`**: the layout is `body { position: fixed; height: 100vh }` with an inner scrolling container, so WKWebView's reflexive scroll-to-focused-element would drag the toolbar off-screen; the controller pins the outer scroll offset while the keyboard animates and samples the keyboard's top edge every frame into the `--tn-keyboard-gap` CSS variable so the editor toolbar follows an interactive swipe-dismiss. `Keyboard.resize: "native"` in the config is part of the same contract. Because `native` shrinks the WebView (the controller's whole `view`) to the keyboard's top, the area behind the keyboard is the `UIWindow`, whose default background is black and shows through the keyboard's rounded corners; `Keyboard.autoBackdropColor: "dom"` makes the plugin repaint the window with `body`'s computed background on every `keyboardWillShow`. Change the keyboard/toolbar CSS on the client and this controller together.
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

CI: `mobile.yml` (pull requests) builds a debug APK via `.github/actions/build-mobile` and an unsigned iOS **Simulator** `.app` on macOS; `nightly.yml` calls the same action with `nightly: "true"` for the signed `assembleRelease` build under the `.nightly` app id. The action runs the Android JVM unit tests before assembling, and `mobile.yml` uploads their JaCoCo report to Codecov under the `mobile` flag; a separate Ubuntu job runs `swift test` on `apps/mobile/ios/RequestBroker`; the JS unit tests live in the standalone suite.

**Debugging on a device:** a *release*-type build (what `nightly.yml` produces) suppresses WebView
console→logcat forwarding, so anything logged from JS is invisible to `adb logcat` and log-based
detection of what the app is doing goes blind. `android.util.Log` calls from the native side still
come through, so instrument the Java layer — or install a debug build — when you need to see what
is happening.

## Testing

Everything JS-side is under the standalone Vitest suite (happy-dom + real sqlite-wasm):

```bash
pnpm --filter standalone test capacitor_http_handler  # Android proxy probe / plugin fallback
pnpm --filter standalone test capacitor_download      # chunked base64 write, filename parsing, share sheet
pnpm --filter standalone test sw                      # service-worker routing incl. capacitor:// guard
pnpm --filter standalone test native-request-bridge   # both platforms' request bridge: channels, framing, base64, redirects
pnpm --filter standalone test main                    # boot wiring (native HTTP handler, native request bridge or the SW)
```

Simulate the platform in a spec by stubbing `location.protocol` / `window.Capacitor` (`getPlatform`, `isNativePlatform`, `Plugins.CapacitorHttp`) — see the existing specs for the fixtures.

The Android Java has JVM unit tests (JUnit 4) under `apps/mobile/android/app/src/test/`:

```bash
cd apps/mobile/android
./gradlew testDebugUnitTest                                    # needs a JDK 21 and ANDROID_HOME
./gradlew testDebugUnitTest createDebugUnitTestCoverageReport  # + app/build/reports/coverage/test/debug/
```

The project needs `cap sync android` (or `cap update android`) once first, for the generated `capacitor-cordova-android-plugins/`.

- **Only Android-free classes are testable.** Unit tests compile against `android.jar`, whose classes (`Uri`, `Handler`, `Log`, `Base64`, `WebResourceResponse`) are stubs that throw "Method not mocked". Logic therefore lives in classes that import none of them (`LocalRequestBroker`, `NativeHttpProxy`, `InterceptedResponse`), with the WebView, the main thread, base64 and logging passed in; the `Trilium*` classes and `MainActivity` are thin adapters with no tests, and the request-path ones (`TriliumRequestBridge`, `TriliumWebViewClient`, `MainActivity`) are listed under `ignore:` in `codecov.yml` so the patch check does not count them. Keep new native logic on the same side of that line, and a new adapter goes on that list.
- **`org.json` comes from a `testImplementation` dependency**, since `android.jar`'s copy is a stub too. **`com.sun.net.httpserver` is not on the test classpath**, so `NativeHttpProxyTest` serves canned responses from a `ServerSocket` (`StubServer`).
- **`minSdk` is 24**: `String.join` and `java.util.Base64` need API 26, so production code avoids them; tests can use them.

Client behavior that differs on the device itself (the keyboard, the visual viewport, touch scrolling) can't be reproduced by these suites or by Playwright. When the device's browser shows it against `pnpm server:start`, log readings into the dev server's log and replay them: the `building-client-ui` skill, `references/measuring-on-a-device.md`.
The iOS request logic has XCTest tests in a Swift package, `apps/mobile/ios/RequestBroker/`:

```bash
cd apps/mobile/ios/RequestBroker
swift test                 # macOS, or Linux with the official swift.org toolchain
```

- **The App target compiles the package's source.** `RequestBroker.swift` is referenced from `project.pbxproj` by relative path (`../../RequestBroker/Sources/RequestBroker/RequestBroker.swift`), not imported as a package, so it lands in the App module next to `TriliumRequestBridge.swift`. The package sits outside `App/` so Xcode and `cap sync` never see its `Package.swift`.
- **Same rule as Android: logic stays out of the WebKit side.** `RequestBroker` imports only Foundation (plus `FoundationNetworking` on Linux, for `HTTPURLResponse`) and talks to a `SchemeTask` protocol; script evaluation, scheduling and logging are passed in. `TriliumRequestBridge.swift` keeps only what needs WebKit and has no tests.
- **nixpkgs' Swift cannot run `swift test` as is.** It lacks `libIndexStore.so`, which Linux test discovery reads, and its manifest runner does not find `libdispatch.so`. Copy the package elsewhere, add a `Tests/LinuxMain.swift` calling `XCTMain` with a hand-written `allTests` list, and run `swift test --disable-index-store` in `nix-shell -p swift swiftpm swiftPackages.{Foundation,XCTest,Dispatch}` with `LD_LIBRARY_PATH` pointing at those packages' libraries. Do not commit a `LinuxMain.swift`: CI's toolchain discovers tests itself.
