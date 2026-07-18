# Running tests & configuration (Trilium)

Trilium gives **each** `packages/ckeditor5-*` package its own `vitest.config.ts` (built with
`defineConfig` directly — there is no shared factory). Vitest is `4.1.8`.

## Per-package scripts

Each package's `package.json` defines:

| Script | Command | Purpose |
|--------|---------|---------|
| `test` | `vitest` | Run the package's tests (configs set `watch: false`, so this is one-shot). |
| `test:debug` | `vitest --inspect-brk --no-file-parallelism --browser.headless=false` | Attach a debugger and watch a browser-mode run with a visible window. |

Run a single package from anywhere in the monorepo:

```bash
pnpm --filter @triliumnext/ckeditor5-math test
```

Or, from the package directory: `vitest run`. Add `-t "name"` to filter by test name, or a
filename substring to filter by file.

## Two config shapes

### happy-dom (e.g. `admonition`, `collapsible`)

Light, no coverage thresholds. Not a real browser — `getBoundingClientRect()` is zeroed, layout
and `ResizeObserver` are stubbed. Use for model/conversion/command logic.

```ts
import { defineConfig } from 'vitest/config';
import svg from 'vite-plugin-svgo';

export default defineConfig( {
	plugins: [ svg() ],
	test: {
		environment: 'happy-dom',
		include: [ 'tests/**/*.[jt]s' ],
		globals: true,
		watch: false,
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			include: [ 'src/**/*.{ts,tsx}' ],
			exclude: [ '**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts' ],
			reporter: [ 'text', 'lcov' ]
		}
	}
} );
```

### WebdriverIO browser mode (e.g. `footnotes`, `keyboard-marker`, `math`, `mermaid`)

Real headless Chrome via `@vitest/browser-webdriverio` (**not** Playwright). Real DOM/layout.
Gates `src/**` coverage at 100%.

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
		include: [ 'tests/**/*.[jt]s' ],
		exclude: [ 'tests/setup.ts' ],
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

Common to both: `globals: true`, the `vite-plugin-svgo` plugin so `import icon from './x.svg'`
resolves, and coverage via `v8` over `src/**` (test files themselves excluded).

**Test-file location depends on where the code lives.** The two configs above are the existing
**standalone packages**, which use a `tests/` directory (`include: ['tests/**/*.[jt]s']`, no
`.spec` suffix) — keep them that way. The **aggregator** (`packages/ckeditor5`), **in-aggregator
plugins** (`src/plugins/`), and **any new code** instead use **co-located `*.spec.ts`** next to the
source — vitest `include: ['src/**/*.spec.ts']` (e.g. `src/plugins/collapsible_list_items.spec.ts`).
This is the repo-wide convention (see the `writing-unit-tests` skill) and what
`feature/collapsible_experiment` uses. New standalone packages should also adopt co-located
`.spec.ts`.

## Coverage scope for the aggregate (`packages/ckeditor5`)

The aggregate **imports** the sibling `@triliumnext/ckeditor5-*` workspace packages, so a plain
`--coverage` run instruments their loaded `src/` too — and the `include: ['src/**']` glob matches
those sibling sources. The report then reads a misleading **~48%** instead of the aggregate's real
number. Those siblings carry their own 100% gates in their own packages, so scope the aggregate's
report to its own sources only — `packages/ckeditor5/vitest.config.ts` does this with:

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
pnpm test:parallel     # all but math & mermaid (and server/ckeditor5), in parallel
pnpm test:sequential   # math & mermaid (and server/ckeditor5), sequentially
pnpm test:all          # test:parallel && test:sequential
```

`math` and `mermaid` **must** run sequentially — running multiple headless Chrome instances at
once exhausts resources. The aggregator (`ckeditor5`) is also in the sequential group (its
`src/**/*.spec.ts` includes browser-mode specs); `server` is there for a different reason (shared
test DB, per `CLAUDE.md`), not browser limits. Light (happy-dom) packages run in parallel.

## Notes

- Some packages (`admonition`, `footnotes`, `keyboard-marker`) have a vitest config but **no tests
  yet** (`passWithNoTests` / empty `tests/`). Adding tests is encouraged.
- There are **no** manual-test or memory-leak harnesses in the Trilium plugin packages (those
  exist only in the upstream ckeditor5 monorepo).
