---
name: developing-capacitor-mobile
description: Use when working on the Trilium mobile app (`apps/mobile`, Capacitor for Android/iOS) or on the standalone code paths that only run inside it — request routing on `capacitor://` vs `https://localhost`, the iOS fetch/XHR/image/stylesheet interceptors, the Android native streaming HTTP proxy (`TriliumWebViewClient`), the `NativeHttpHandler` sync transport, `MainActivity`/`ViewController` WebView tweaks (edge-to-edge, keyboard), `isMobileApp()` gating in the client, or the mobile CI/nightly builds. Also load it when reviewing a diff that touches these files, so working iOS-only code is not flagged as dead.
---

# Developing the Capacitor mobile app

`apps/mobile` is a **Capacitor shell around the standalone build**: it ships no web assets of its own — `webDir` in `capacitor.config.json` is `../standalone/dist`, and the entire Trilium server runs **in-process as WASM in a web worker** (`apps/standalone`). There is no network backend inside the app; "the server" is `apps/standalone/src/local-server-worker.ts`. Most mobile work therefore lands in `apps/standalone/src/`, with the native projects (`apps/mobile/android/`, `apps/mobile/ios/`) touched only for WebView behaviour.

Key files:

```
apps/mobile/capacitor.config.json          # appId org.triliumnotes.trilium, androidScheme https, hostname localhost, plugins
apps/mobile/android/app/src/main/java/org/triliumnotes/trilium/
    MainActivity.java                      # installs TriliumWebViewClient, edge-to-edge + insets, system bar appearance
    TriliumWebViewClient.java              # streaming same-origin HTTP proxy for the sync worker (Android only)
apps/mobile/ios/App/App/ViewController.swift   # keyboard handling: pins outer scroll, drives --tn-keyboard-gap
apps/standalone/src/main.ts                # boot: registers native HTTP handler if `Capacitor` in window; iOS interceptors
apps/standalone/src/ios-interceptors.ts    # fetch / XHR / <img> / stylesheet interceptors, iOS only
apps/standalone/src/services/capacitor_http_handler.ts   # NativeHttpHandler: Android proxy probe + CapacitorHttp fallback
apps/standalone/src/local-bridge.ts        # LOCAL_API_PREFIXES, localFetch(), registerNativeHttpHandler()
apps/standalone/src/sw.ts                  # service worker routing (Android + web); guards for capacitor:// and the native proxy
apps/client/src/services/utils.ts          # isMobileApp() — running inside the native wrapper
.github/workflows/mobile.yml, .github/actions/build-mobile   # APK + iOS simulator builds, nightly signing
```

## Inbound: how the client's API calls reach the in-app worker

The client's `/api`, `/sync`, `/bootstrap`, `/search` requests (`LOCAL_API_PREFIXES` in `local-bridge.ts`) must be answered by the worker. The two platforms do it differently because their WebViews resolve `*Scheme: "https"` differently:

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

## Native shells

- **Android `MainActivity`**: sets `TriliumWebViewClient`, draws edge-to-edge with transparent system bars, forwards window insets to the WebView (so the client can pad for the status/navigation bars) and re-applies system bar appearance on configuration change. Nightly and debug builds get a distinct `applicationId` suffix (`.nightly`, `.debug`) and launcher icon so they install side by side (`android/app/build.gradle`).
- **iOS `ViewController`**: the layout is `body { position: fixed; height: 100vh }` with an inner scrolling container, so WKWebView's reflexive scroll-to-focused-element would drag the toolbar off-screen; the controller pins the outer scroll offset while the keyboard animates and samples the keyboard's top edge every frame into the `--tn-keyboard-gap` CSS variable so the editor toolbar follows an interactive swipe-dismiss. `Keyboard.resize: "native"` in the config is part of the same contract. Change the keyboard/toolbar CSS on the client and this controller together.
- `limitsNavigationsToAppBoundDomains: true` on iOS.

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
pnpm --filter standalone test sw                      # service-worker routing incl. capacitor:// guard
pnpm --filter standalone test main                    # boot wiring (native handler registered, interceptors installed on capacitor:)
```

Simulate the platform in a spec by stubbing `location.protocol` / `window.Capacitor` (`getPlatform`, `isNativePlatform`, `Plugins.CapacitorHttp`) — see the existing specs for the fixtures. Native Java/Swift has no test harness in the repo; keep logic there minimal and mirror the protocol on the JS side where it is testable.
