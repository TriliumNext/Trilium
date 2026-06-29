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
| A CKEditor 5 plugin in **Trilium's own bundle** (`packages/ckeditor5`) | Browser-mode (headless Chrome): `ClassicEditor.create` + `licenseKey: "GPL"` + `_setModelData`, co-located `src/**/*.spec.ts` | **trilium-ckeditor5-integration** skill |
| Pure logic (parsers, formatters, math, data maps) | Plain Vitest, no harness | any reference |

### Specialized harnesses (owned by sibling skills)

Some layers have a purpose-built spec harness documented in the skill that owns the feature — route there instead of re-deriving it:

| You're testing… | Harness shape | Skill |
|---|---|---|
| A DB migration (`packages/trilium-core/src/migrations/*`) | `getSql()` captured **in `beforeEach`** (not at describe time — core isn't initialized yet) + `sql.rebuildFromBuffer(fixtureDb)` per test, mutated inside `cls.getContext().init` | **evolving-the-data-model** |
| An LLM / MCP tool (`apps/server/src/services/llm/tools/*`) | `getTool(name)` walks the registry + `cls.init(() => getTool(name).execute(...))` | **adding-llm-mcp-tools** |
| An Electron preload bridge method (`apps/desktop/src/preload.ts`) | `vi.mock("electron", …)` mirroring the IPC channels into in-memory maps; assert the exposed `window.electronApi` shape (`apps/desktop/src/preload.spec.ts`) | **electron-desktop-bridge** |

## Running tests

- Whole package: `pnpm --filter <pkg> test` (e.g. `@triliumnext/client`, `@triliumnext/server`, `@triliumnext/commons`).
- Single file (server): `pnpm --filter server test spec/etapi/search.spec.ts`
- Single file (client): `pnpm --filter @triliumnext/client exec vitest run src/widgets/react/Button.spec.tsx`
- Coverage: append `--coverage`.
- Server tests run **sequentially** (shared DB, `pool: "forks"`, fork isolation is **per file**). Client/package tests run in parallel.

> **Windows/sandbox note:** `pnpm --filter … exec vitest` can trigger a pnpm auto-install that hits `EPERM`. If so, run the hoisted binary directly (it lives in the **repo-root** `node_modules`): `CI=true node node_modules/vitest/vitest.mjs run <spec> --root apps/client`, or `node_modules/.bin/vitest.CMD run <spec> --root apps/<app>`.

## Core specs run twice (server + standalone WASM)

Every `packages/trilium-core/src/**/*.spec.ts` runs **a second time** under the standalone suite — `apps/standalone/vite.config.mts` pulls them into its `test.include` and runs them in happy-dom against **sqlite-wasm** with the browser crypto/SQL providers. Consequences:

- **A green server run isn't a green standalone run.** Before calling a core change done, run `pnpm --filter standalone test <spec>` too — node-only assumptions diverge there (`process.memoryUsage` is undefined, `better-sqlite3`-only `serialize()` throws, `window` exists).
- **WASM scrypt is ~10x slower** (pure-JS `scrypt-js` under V8 coverage). scrypt/login/password specs bump the timeout for the standalone runtime only — copy this guard for any new core spec that hashes (`packages/trilium-core/src/routes/api/login.spec.ts:13`):
    ```ts
    const isBrowserRuntime = typeof window !== "undefined";
    if (isBrowserRuntime) {
        vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
    }
    ```
- The shims that make this work live in `apps/standalone/src/test_setup.ts` (a `file://` fetch interceptor, a non-streaming `WebAssembly.instantiate` fallback, and a happy-dom `<pre>` leading-newline patch) — you don't add them per-spec, but they explain why a core spec can behave slightly differently under standalone.

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
- For provably-unreachable defensive branches, mark them with `/* v8 ignore next */` / `/* v8 ignore start */…/* v8 ignore stop */` and a one-line reason — don't delete the guard or write a fake test.
- **Checking one file's coverage:** the v8 **text** reporter crashes (`PARSE_ERROR` while remapping unrelated uncovered core files) on single-spec `--coverage` runs. Produce `lcov`/`json`/`json-summary` instead and parse it with the **analyzing-coverage** skill's `coverage.mjs` (`… summary` for pct/aggregate, `… gaps --filter <file>` for the uncovered line list). The full-suite text report (run over a directory) is fine. Don't hand-roll a coverage parser — that script already handles all three formats and the Windows footguns.

## Universal gotchas

- **No non-null assertions (`!`)** — never use the TypeScript postfix `!` operator, even in tests. Narrow instead: `becca.getNoteOrThrow(id)`/`getAttachmentOrThrow(id)` instead of `becca.getNote(id)!`; `value?.prop ?? fallback` then assert; or capture into a const after an `expect(x).toBeDefined()`/null check. (Project rule — see `CLAUDE.md` Code Style.)
- **`vi.mock` is hoisted** above imports. Put component/module imports *after* the `vi.mock(...)` calls; mock factories can't reference outer non-hoisted variables. Partial-mock with `async (importOriginal) => ({ ...(await importOriginal()), onlyThis: vi.fn() })`.
- **Don't assert on translated (i18n) strings** — assert structure/keys/behavior (classes, counts, ids), not human-readable English.
- **happy-dom is not a browser:** `getBoundingClientRect()` returns zeros, `ResizeObserver`/layout/visibility are stubs. Anything pixel/size/scroll-based needs `@vitest/browser`, not happy-dom.
- **`@vitest/browser` real-browser mode IS configured** — the `packages/ckeditor5`, `-mermaid`, and `-math` bundles run their co-located `src/**/*.spec.ts` in headless Chrome (`@vitest/browser-webdriverio`; see `packages/ckeditor5/vitest.config.ts`). These are the browser-mode `test:sequential` suites. Reserve real-browser mode for genuine layout/integration needs (CKEditor, Excalidraw, Modal transitions, size measurement); normal unit tests stay on happy-dom.
