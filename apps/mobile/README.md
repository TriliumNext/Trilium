# @triliumnext/mobile

Capacitor shell that wraps the [`@triliumnext/standalone`](../standalone/) PWA build as a native mobile app. This package does not ship its own web assets — `webDir` in [capacitor.config.json](./capacitor.config.json) points directly at `../standalone/dist`.

## Prerequisites

- Android SDK + an emulator or attached device (set up `ANDROID_HOME` / `ANDROID_SDK_ROOT`).
- JDK 17+.
- The monorepo installed: `corepack enable && pnpm install` at the repo root.

## First-time setup

```bash
# 1. Build the standalone web app into apps/standalone/dist
pnpm --filter @triliumnext/mobile build

# 2. Generate the native Android project (one-off — commits as apps/mobile/android/)
pnpm --filter @triliumnext/mobile exec cap add android
```

## Everyday loop

```bash
pnpm --filter @triliumnext/mobile build          # rebuild standalone dist
pnpm --filter @triliumnext/mobile sync           # copy dist into android/
pnpm --filter @triliumnext/mobile run:android    # launch on emulator/device
# or
pnpm --filter @triliumnext/mobile open:android   # open Android Studio
```

## How web requests reach the local server (Android vs iOS)

There is **no network backend** — the whole server runs in-process as WASM in a web worker. How the client's API/sync calls (`/api`, `/sync`, `/bootstrap`, `/search`) reach that worker differs by platform, because the two WebViews resolve `*Scheme: "https"` differently:

- **Android** — `androidScheme: "https"` works: the app loads at `https://localhost` (a real secure origin), so the **service worker** ([`apps/standalone/src/sw.ts`](../standalone/src/sw.ts)) intercepts those requests and forwards them to the worker.
- **iOS** — the app loads at **`capacitor://localhost`** and uses **fetch / XHR / image interceptors** ([`apps/standalone/src/main.ts`](../standalone/src/main.ts), gated on `location.protocol === "capacitor:"`) instead, because a service worker cannot register on `capacitor://` (`navigator.serviceWorker.register()` throws — the scheme is not HTTP/HTTPS).

**Why iOS is on `capacitor://` and not `https`:** Capacitor **ignores** `iosScheme: "https"`. WKWebView reserves the `http`/`https` schemes, so `CAPInstanceDescriptor.normalize()` (`WKWebView.handlesURLScheme("https") == true`) rejects it and resets the scheme to the default `capacitor`. That's why `iosScheme` is intentionally **not** set here — it would be a no-op that falsely implies iOS runs on an https origin.

> ⚠️ **Do not remove the iOS interceptor path as "dead code."** It is the only working request path on iOS. And do not re-add `iosScheme: "https"` — it does nothing on iOS and is misleading.
