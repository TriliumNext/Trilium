# @triliumnext/mobile

Capacitor shell that wraps the [`@triliumnext/client-standalone`](../client-standalone/) PWA build as a native mobile app. This package does not ship its own web assets — `webDir` in [capacitor.config.json](./capacitor.config.json) points directly at `../client-standalone/dist`.

## Prerequisites

- Android SDK + an emulator or attached device (set up `ANDROID_HOME` / `ANDROID_SDK_ROOT`).
- JDK 17+.
- The monorepo installed: `corepack enable && pnpm install` at the repo root.

## First-time setup

```bash
# 1. Build the standalone web app into apps/client-standalone/dist
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
