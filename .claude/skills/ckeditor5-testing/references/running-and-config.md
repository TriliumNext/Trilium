# Running tests & configuration (Trilium)

One package carries the CKEditor 5 tests: `packages/ckeditor5` (the aggregate, which holds every
in-tree plugin under `src/plugins/`). Its `vitest.config.ts` is built with `defineConfig` directly
— there is no shared factory. Vitest is 4 or
later.

## Per-package scripts

Each package's `package.json` defines:

| Script | Command | Purpose |
|--------|---------|---------|
| `test` | `vitest` | Run the package's tests (configs set `watch: false`, so this is one-shot). |
| `test:debug` | `vitest --inspect-brk --no-file-parallelism --browser.headless=false` | Attach a debugger and watch a browser-mode run with a visible window. |

Run a single package from anywhere in the monorepo:

```bash
pnpm --filter @triliumnext/ckeditor5 test
```

Or, from the package directory: `vitest run`. Add `-t "name"` to filter by test name, or a
filename substring to filter by file.

### Supplying the browser and driver

webdriverio downloads a Chrome for Testing build and a matching chromedriver into `/tmp` on first
run. Where those cannot execute — NixOS, where they are linked against libraries no store path
provides and abort on a missing `libxcb.so.1` — two variables hand it a system pair instead:

| Variable | Read by | Effect |
|---|---|---|
| `CHROMEDRIVER_PATH` | webdriverio (`@wdio/utils` `startWebDriver`) | Spawns that driver on a free port instead of downloading one. |
| `CHROME_BIN` | `packages/ckeditor5/vitest.config.ts` | Passed as `goog:chromeOptions.binary`; `setupPuppeteerBrowser` returns early for a string `binary`, so no browser is downloaded either. |

```bash
CHROME_BIN=/path/to/chromium CHROMEDRIVER_PATH=/path/to/chromedriver \
    pnpm --filter @triliumnext/ckeditor5 test
```

The versions must match at least in their major. `nix develop` exports both from `pkgs.chromium`
and `pkgs.chromedriver` (same nixpkgs revision, so they agree), which is why the plain command works
inside the dev shell. Starting a chromedriver by hand and writing a local config that connects to
its port does work, but it is strictly more setup — reach for the variables.

A failing browser test writes a PNG into a gitignored `__screenshots__` directory next to the spec.
Clean those up when done.

## The config shape

Both packages run **WebdriverIO browser mode**: real headless Chrome via
`@vitest/browser-webdriverio` (**not** Playwright), with real DOM and layout, gating `src/**`
coverage at 100%. Trilium previously ran some plugins on happy-dom; no CKEditor package does now.

```ts
import { defineConfig } from 'vitest/config';
import svg from 'vite-plugin-svgo';
import { webdriverio } from '@vitest/browser-webdriverio';

export default defineConfig( {
	plugins: [ svg() ],
	test: {
		browser: {
			enabled: true,
			provider: webdriverio(),
			headless: true,
			ui: false,
			instances: [ { browser: 'chrome' } ]
		},
		include: [ 'src/**/*.spec.ts' ],       // math instead uses [ 'tests/**/*.[jt]s' ]
		setupFiles: [ './test/setup.ts' ],     // aggregate only — wires the editor-kit teardown
		globals: true,
		watch: false,
		coverage: {
			thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
			provider: 'v8',
			include: [ 'src/**/*.{ts,tsx}' ],
			exclude: [ '**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts' ],
			reporter: [ 'text' ]
		}
	}
} );
```

Also standard: `globals: true`, the `vite-plugin-svgo` plugin so `import icon from './x.svg'`
resolves, and coverage via `v8` over `src/**` (test files themselves excluded).

**Test-file location.** `packages/ckeditor5` uses **co-located `*.spec.ts`** next to the source —
`include: ['src/**/*.spec.ts']` — including inside plugin folders, e.g.
`src/plugins/collapsible/collapsible_editing.spec.ts`. That is the repo-wide convention (see the
`writing-unit-tests` skill).

The aggregate also sets `setupFiles: ['./test/setup.ts']`, which wires the global `afterEach` that
destroys editors created through `test/editor-kit.ts`.

## Coverage scope for the aggregate (`packages/ckeditor5`)

The aggregate used to import sibling `ckeditor5-*` packages, whose loaded `src/` a plain
`--coverage` run would instrument too, dragging the report below the aggregate's real number.
Nothing sibling is left, but the report is still scoped to this package's own sources —
`packages/ckeditor5/vitest.config.ts` does this with:

```ts
coverage: {
	provider: 'v8',
	allowExternal: false,                    // don't reach outside the package root
	include: [ 'src/**/*.{ts,tsx}' ],
	exclude: [
		'**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts',
		'**/node_modules/**', '**/ckeditor5-*/**' // <- keeps imported siblings out
	],
	reporter: [ 'text', 'lcov' ],
	reportsDirectory: './test-output/vitest/coverage'
}
```

`reporter: ['text', 'lcov']` + that `reportsDirectory` are what the `analyzing-coverage`
analyzer (`lcov.info`) and Codecov consume — keep them when adding coverage to a package.

## When the session never starts

Two failure modes look like a broken suite but are environmental.

### "This version of ChromeDriver only supports Chrome version N"

webdriverio auto-manages the driver by detecting the installed Chrome's version. When Chrome has a
**staged update** — a `new_chrome.exe` and a new version folder sitting in the install directory,
waiting for a browser restart — detection reads the *staged* version and downloads that
chromedriver, while the `chrome.exe` that actually launches is still the old major. Every run then
dies at session start.

Restarting Chrome fixes it permanently. To run before then, point wdio at the matching driver
already in its cache (`%TEMP%\chromedriver\win64-<version>\` on Windows) by editing
`packages/ckeditor5/vitest.config.ts` — at the **provider factory** level, because
`@vitest/browser-webdriverio` drops per-instance options and only the factory's reach `remote()`:

```ts
provider: webdriverio({
    capabilities: {
        "wdio:chromedriverOptions": { binary: "<cached>/chromedriver-win64/chromedriver.exe" }
    }
}),
```

**Revert that edit after the run — never commit it.** `browserVersion` pins do not help at either
level; wdio still resolves the local binary.

### The run hangs at `[vite] [optimizer] bundling dependencies...`

In a fresh git worktree the browser-mode suite reliably stalls there and never runs a test,
eventually reporting "Browser connection was closed" or "no tests" — even after clearing
`node_modules/.vite` and killing stray browsers. The cold Vite dep-optimize for the very large
CKEditor dep set does not complete (it may be contending with the editor's own Vitest extension
workers). The same spec runs in seconds from the **main checkout**, where that cache is warm.

So validate browser-mode specs from the main checkout: copy the new `*.ts` + `*.spec.ts` into
`<main>/packages/ckeditor5/src/plugins/`, run them there (add
`--coverage.enabled --coverage.include='<file>'` to check the 100 % gate against just that file),
then delete the temporary copies. A spec that imports the plugin directly does not need the
`plugins.ts` / toolbar wiring to be present in main. Client (`apps/client`) happy-dom tests are
unaffected — this is browser-mode only.

### After an aborted run

Killed runs leave **orphaned headless Chrome** processes (`--test-type=webdriver`, a `scoped_dir`
user-data directory) holding resources. Kill those, and only those — never the user's interactive
Chrome, and never the editor's Vitest extension workers or its Vite dev server. Also don't pipe
vitest through `Select-Object -Last N`: it buffers everything until exit, so you lose all progress
output.

## Debugging

Browser-mode packages support an inspector + visible browser:

```bash
vitest --inspect-brk --no-file-parallelism --browser.headless=false
# i.e. the package's `test:debug` script
```

`--no-file-parallelism` keeps one file at a time so breakpoints are predictable;
`--browser.headless=false` shows the Chrome window.

## Root orchestration

The root `package.json` splits the run because the browser-mode packages compete for browser
resources:

```bash
pnpm test:parallel     # everything except server and ckeditor5, in parallel
pnpm test:sequential   # server and ckeditor5, sequentially
pnpm test:all          # test:parallel && test:sequential
```

`ckeditor5` **must not** run alongside another browser-mode suite — multiple headless Chrome
instances at once exhaust resources. `server` is in the same group for a different reason (shared
test DB, per `CLAUDE.md`), not browser limits. Everything else runs in parallel.

## Notes

- Both packages are at **100% coverage** and gated there, so a change that adds a line adds a test.
- There are **no** manual-test or memory-leak harnesses in the Trilium plugin packages (those
  exist only in the upstream ckeditor5 monorepo).
