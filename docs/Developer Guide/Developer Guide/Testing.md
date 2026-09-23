# Testing
### Test Organization

**Parallel Tests** (can run simultaneously):

*   Client tests
*   Package tests
*   E2E tests (isolated databases)

**Sequential Tests** (shared resources):

*   Server tests (shared database)
*   CKEditor plugin tests

### Test Frameworks

*   **Vitest** - Unit and integration tests
*   **Playwright** - E2E tests
*   **Happy-DOM** - DOM testing environment

## Test locations

```
apps/
├── server/
│   └── src/**/*.spec.ts       # Server tests
├── client/
│   └── src/**/*.spec.ts       # Client tests
├── server/
│   └── e2e/**/*.spec.ts       # Server-specific E2E tests
└── desktop/
    └── e2e/**/*.spec.ts       # Desktop E2E tests
packages/
└── trilium-e2e/
    └── src/**/*.spec.ts       # Shared E2E tests
```

## Running tests

At project root:

```
pnpm test:all          # All tests
pnpm test:parallel     # Fast parallel tests
pnpm test:sequential   # Sequential tests only
```

## Unit testing and integration testing

Using `vitest`, there are some unit and integration tests done for both the client and the server.

These tests can be found by looking for the corresponding `.spec.ts` in the same directory as the source file.

<table>
    <tbody>
        <tr>
            <td><p>To run the server-side tests:</p><pre><code class="language-text-x-trilium-auto">npm run server:test</code></pre><p>To view the code coverage for the server:</p><pre><code class="language-text-x-trilium-auto">npm run server:coverage</code></pre><p>Afterwards, a friendly HTML report can be found in <code>/coverage/index.html</code>.</p></td>
            <td><p>To run the client-side tests:</p><pre><code class="language-text-x-trilium-auto">npm run client:test</code></pre><p>To view the code coverage for the client:</p><pre><code class="language-text-x-trilium-auto">npm run client:coverage</code></pre><p>Afterwards, a friendly HTML report can be found in <code>/src/public/app/coverage/index.html</code>.</p></td>
        </tr>
    </tbody>
</table>

To run both client and server-side tests:

```
npm run test
```

Note that some integration tests rely on an in-memory database in order to function. 

### Browser-mode tests for the text editor

`packages/ckeditor5` runs its tests in a real headless Chromium, through `@vitest/browser-playwright`, because the editor needs a real DOM and real selection handling. Playwright downloads the browser itself; install it once with `pnpm exec playwright install chromium` from the repository root.

Where that downloaded browser cannot run — NixOS being the case in point, since it is dynamically linked against libraries no store path provides and dies on a missing `libxcb.so.1` — point the suite at a system browser instead:

```
CHROME_BIN=/path/to/chromium pnpm --filter @triliumnext/ckeditor5 test
```

`CHROME_BIN` is read by the package's `vitest.config.ts` and passed to the provider as `launchOptions.executablePath`, so Playwright launches that binary rather than its own download. There is no separate driver to supply — Playwright speaks CDP to the browser directly.

The Nix dev shell (`nix develop`) sets it from `pkgs.chromium`, so inside it the tests run unchanged.

### REST API testing for the server

API tests are handled via `vitest` and `supertest` to initialize the Express server and run assertions without having to make actual requests to the server.

An important aspect is that we have access to the Express `app` which allows for interesting assertions such as checking the state of the server, registering debug middleware and so on.

One example is `src/share/routes.spec.ts`, or for the ETAPI in `apps/server/spec/etapi`.

These integration tests are run alongside unit tests.

## End-to-end testing

See <a class="reference-link" href="Testing/End-to-end%20tests.md">End-to-end tests</a>.