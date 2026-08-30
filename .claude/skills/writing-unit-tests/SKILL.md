---
name: writing-unit-tests
description: Use when writing, extending, or debugging Vitest unit tests anywhere in the Trilium monorepo — Preact components, jQuery widgets, client services, or the server/trilium-core backend. Covers how to render components (zero new deps), the easy-froca/becca fixtures, supertest API patterns, the honest coverage config, running a single test, and the known gotchas.
---

# Writing unit tests in Trilium

Trilium is a pnpm monorepo tested with **Vitest** (v8 coverage). This skill captures the patterns that actually work here, plus the footguns that waste time. Read the per-layer reference file for the area you're touching.

## First principle: prefer extracting pure logic

The dominant, lowest-risk pattern across this repo is **extract the decision/transform logic out of a component/widget/route into a top-level `export function` that takes plain inputs and returns a plain value, then test that function.** Rendering and side effects stay thin; the logic gets covered cheaply. `apps/client/src/widgets/ribbon/FormattingToolbar.tsx` (`getFormattingToolbarState`, tested in `FormattingToolbar.spec.ts`) is the canonical example. Reach for rendering/integration only when the behavior *is* the DOM/HTTP.

Also follow `CLAUDE.md`: write **concise** tests (group related assertions in one `it`, don't make one test per trivial passthrough), and when you add pure business logic, extract + unit-test it.

## Which technique? (decision tree)

| You're testing… | Technique | Reference |
|---|---|---|
| A reusable Preact component (`apps/client/src/widgets/react/`) | Render with raw `preact` `render()` into a happy-dom div | [client-components.md](client-components.md) |
| A jQuery widget / type widget | Extract logic → test fn; or instantiate + assert on `$widget` | [client-logic-and-services.md](client-logic-and-services.md) |
| A client service (`apps/client/src/services/`) | `easy-froca` + override `server.*`; or pure logic | [client-logic-and-services.md](client-logic-and-services.md) |
| A server service (`apps/server/src` or `packages/trilium-core/src`) | Real in-memory DB (`sql_init` + `cls.init`) or mocked becca | [server-and-core.md](server-and-core.md) |
| A shared **core** API route (`packages/trilium-core/src/routes/api/*`) | `CoreApiTester` — in-process, cross-runtime, real services (incl. zip export/import/multipart), minimal mocks | [server-and-core.md](server-and-core.md) Pattern 0 |
| An internal REST API route's Express transport (CSRF/auth/wiring) | `supertest` agent + `/login` + `/bootstrap` CSRF | [server-and-core.md](server-and-core.md) Pattern 1 |
| An ETAPI endpoint | `supertest` + basic-auth via `spec/etapi/utils.ts` | [server-and-core.md](server-and-core.md) |
| Pure logic (parsers, formatters, math, data maps) | Plain Vitest, no harness | any reference |

### Specialized harnesses (owned by sibling skills)

Some layers have a purpose-built spec harness documented in the skill that owns the feature — route there instead of re-deriving it:

| You're testing… | Harness shape | Skill |
|---|---|---|
| A DB migration (`packages/trilium-core/src/migrations/*`) | `getSql()` captured **in `beforeEach`** (not at describe time — core isn't initialized yet) + `sql.rebuildFromBuffer(fixtureDb)` per test, mutated inside `cls.getContext().init` | **evolving-the-data-model** |
| An Electron preload bridge method (`apps/desktop/src/preload.ts`) | `vi.mock("electron", …)` mirroring the IPC channels into in-memory maps; assert the exposed `window.electronApi` shape (`apps/desktop/src/preload.spec.ts`) | **developing-electron-desktop** |
| A CKEditor 5 plugin in Trilium's own bundle (`packages/ckeditor5`) | Browser-mode headless Chrome: `ClassicEditor.create` + `licenseKey: "GPL"` + `_setModelData`, co-located `src/**/*.spec.ts` | **ckeditor5-testing** |

## Running tests

> **Run the narrowest thing that covers the change, and never the full suite.** `pnpm test:all`,
> `test:parallel`, `test:sequential` and `pnpm coverage` take minutes and are CI's job — reach for one
> only if the user asks. **Never run ESLint** either (`pnpm dev:linter-check`/`-fix`, `npx eslint`): it
> currently dies out-of-memory, so a run costs minutes and tells you nothing. Typecheck with
> `pnpm typecheck` (never a raw `tsc -p`/`tsc -b`, which misses the project references) — cheaper than a
> suite, but not instant, so run it once a change is finished rather than after every edit.

- Filtered (preferred): `pnpm --filter <pkg> test <path-or-pattern>` — the trailing argument is a
  substring filter over spec paths, so `pnpm --filter server test special_notes` runs every match.
- Whole package: `pnpm --filter <pkg> test` (e.g. `@triliumnext/client`, `@triliumnext/server`, `@triliumnext/commons`).
- Single file (server): `pnpm --filter server test spec/etapi/search.spec.ts`
- Single file (client): `pnpm --filter @triliumnext/client exec vitest run src/widgets/react/Button.spec.tsx`
- Coverage: append `--coverage`.
- Server tests run **sequentially** (shared DB, `pool: "forks"`, fork isolation is **per file**). Client/package tests run in parallel.

> **Windows/sandbox note:** `pnpm --filter … exec vitest` can trigger a pnpm auto-install that hits `EPERM`. If so, run the hoisted binary directly (it lives in the **repo-root** `node_modules`): `CI=true node node_modules/vitest/vitest.mjs run <spec> --root apps/client`, or `node_modules/.bin/vitest.CMD run <spec> --root apps/<app>`.

## Coverage config rules (Vitest 4)

Each project's test config (`vite.config.*` / `vitest.config.*`) measures coverage honestly via:

```ts
coverage: {
    provider: "v8" as const,
    include: ["src/**/*.{ts,tsx}"],            // makes UNTESTED files count too
    exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"],
    reporter: ["text", "lcov"]
}
```

- **Do NOT use `all: true`** — it was removed in Vitest 4 and is a type error; `include` already pulls in untested files.
- If a config sets Vite `root: "src"` (e.g. `apps/standalone`), coverage `include` globs resolve **relative to `src`**, so use `["**/*.{ts,tsx}"]`, not `["src/**/…"]`.
- **Files outside the project `root` need `coverage.allowExternal: true`.** v8 defaults it to `false`, which **silently drops** every out-of-root file — so an `include` glob alone (e.g. `../../packages/trilium-core/src/**`) is ignored and contributes nothing. `trilium-core` has no runner of its own; its coverage is measured *through* `apps/server` and `apps/standalone`, and both **must** set `allowExternal: true` **plus** a core glob in `coverage.include` whose `../` depth matches that suite's `root`: `../../packages/trilium-core/src/**` for server (root `apps/server`), `../../../packages/trilium-core/src/**` for standalone (root `apps/standalone/src`). Without `allowExternal` core never reaches the lcov or Codecov. The lcov writes these as `../…/packages/…` paths; `codecov.yml`'s `fixes:` entries strip the `../` so they map onto the repo tree.
- For provably-unreachable defensive branches, mark them with `/* v8 ignore next */` / `/* v8 ignore start */…/* v8 ignore stop */` and a one-line reason — don't delete the guard or write a fake test. `/* v8 ignore next */` does **not** reliably suppress a branch sitting on a `} else if (…) {` line — use the `start`/`stop` form there. Better still, check whether the arm is dead because the code can be simplified: a trailing `else if (name) { … } return []` where `name` is provably truthy collapses to a direct `return`, removing the branch honestly instead of hiding it. Project style is a plain `/* v8 ignore next -- reason */` — no `@preserve`.
- **Checking one file's coverage:** the v8 **text** reporter crashes (`PARSE_ERROR` while remapping unrelated uncovered core files) on single-spec `--coverage` runs. Produce `lcov`/`json`/`json-summary` instead and parse it with the **analyzing-coverage** skill's `coverage.mjs` (`… summary` for pct/aggregate, `… gaps --filter <file>` for the uncovered line list). The full-suite text report (run over a directory) is fine. Don't hand-roll a coverage parser — that script already handles all three formats and the Windows footguns.

## Universal gotchas

- **A green Vitest run is not proof the spec compiles.** Vitest strips types with esbuild, so specs are never type-checked by the run itself — and `apps/client/tsconfig.app.json` deliberately **excludes** `src/**/*.spec.ts(x)`. They are checked by `tsconfig.spec.json`, which `pnpm typecheck` reaches through the project references, so **`pnpm typecheck` is the only thing that catches a broken spec** — but run it **once, after the whole batch of specs is written**, never per file or per edit. It walks the project references and costs real time; spending that repeatedly is the single easiest way to make a test-writing session slow. Passing tests routinely hide mechanical type errors that then fail CI. The recurring ones: `act(() => someExpression)` returning a value where a `void` callback is expected, `Component | undefined` passed where the context wants `| null`, and mock-froca helpers whose default `getNote = vi.fn(async () => undefined)` infers `Promise<undefined>` and rejects a caller's `vi.fn(async () => someNote)` — type such params loosely (`(...args: unknown[]) => Promise<unknown>`).
- **No non-null assertions (`!`)** — never use the TypeScript postfix `!` operator, even in tests. Narrow instead: `becca.getNoteOrThrow(id)`/`getAttachmentOrThrow(id)` instead of `becca.getNote(id)!`; `value?.prop ?? fallback` then assert; or capture into a const after an `expect(x).toBeDefined()`/null check. (Project rule — see `CLAUDE.md` Code Style.)
- **`vi.mock` is hoisted** above imports. Put component/module imports *after* the `vi.mock(...)` calls; mock factories can't reference outer non-hoisted variables. Partial-mock with `async (importOriginal) => ({ ...(await importOriginal()), onlyThis: vi.fn() })`.
- **`vi.resetModules()` drops `importOriginal`-based partial mocks.** The next dynamic import of the module gets the *real* dependency back, not your stub, and the symptom reads as "the mock isn't applying" rather than as a reset problem. Prefer registering singletons and IPC handlers **once** and ordering the tests instead — put the one that latches module-level state last. Where a reset is genuinely needed (a value cached on first call), mock with a full factory rather than an `importOriginal` partial.
- **Don't assert on translated (i18n) strings** — assert structure/keys/behavior (classes, counts, ids), not human-readable English.
- **happy-dom is not a browser:** `getBoundingClientRect()` returns zeros, `ResizeObserver`/layout/visibility are stubs. Anything pixel/size/scroll-based needs `@vitest/browser`, not happy-dom.
- **`@vitest/browser` real-browser mode IS configured** — the `packages/ckeditor5`, `-mermaid` and `-math` bundles run their co-located `src/**/*.spec.ts` in headless Chrome (`@vitest/browser-webdriverio`; see `packages/ckeditor5/vitest.config.ts`). These are the browser-mode `test:sequential` suites. Reserve real-browser mode for genuine layout/integration needs (CKEditor, Excalidraw, Modal transitions, size measurement); normal unit tests stay on happy-dom.
- **WASM scrypt is ~10× slower** under the standalone suite (pure-JS `scrypt-js` under V8 coverage instrumentation, vs Node's native `scryptSync`) — enough to blow the 5s default. A core spec that hashes a password bumps the timeout for the standalone runtime only; copy the guard from `packages/trilium-core/src/routes/api/login.spec.ts:13`:
    ```ts
    const isBrowserRuntime = typeof window !== "undefined";
    if (isBrowserRuntime) {
        vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
    }
    ```
- **A spec that hangs at *exit* takes the whole suite down with it.** An unclosed timer, `ResizeObserver`, event listener or in-flight `fetch` can let every test pass and then stop Vitest from exiting — which hangs the full `pnpm test` run, and CI with it. Because the failure is at teardown, the spec looks green in isolation. Diagnose by sweeping the specs one at a time under a hard timeout and looking for exit code 124:

    ```bash
    find <dir> -name '*.spec.tsx' | xargs -P6 -I{} timeout 70 <vitest> run {}
    ```

    Use **absolute paths** in that command — a background shell starts at the repo root, not wherever you last `cd`'d. Clean up the handle in the spec rather than raising the timeout.
