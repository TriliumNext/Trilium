# End-to-end tests
**Server E2E:**

*   Tests the entire ETAPI.
*   Tests WebSocket functionality

**Desktop E2E:**

*   Playwright with Electron
*   Tests some basic functionality such as creating a new document.

Shared E2E tests live in `packages/trilium-e2e/`. Server-specific tests are in `apps/server/e2e/`, desktop tests in `apps/desktop/e2e/`.

Run E2E tests via:
- `pnpm --filter server e2e` (server)
- `pnpm --filter standalone e2e` (standalone)
- `pnpm --filter desktop e2e` (desktop/Electron)

## First-time run

Before starting Playwright, it has to be installed locally via:

```
pnpm playwright install
```

## Starting the integration test server

Simply run `pnpm e2e` in one of the e2e projects.

The integration server doesn't have authentication enabled to avoid login issues.

## Starting the interactive test runner

After starting the integration test server, to run the Playwright UI, run in the terminal:

```
pnpm playwright test --ui
```

It is also possible to run the interactive code generator instead:

```
pnpm playwright codegen
```