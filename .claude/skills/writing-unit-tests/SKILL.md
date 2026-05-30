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
| An internal REST API route | `supertest` agent + `/login` + `/bootstrap` CSRF | [server-and-core.md](server-and-core.md) |
| An ETAPI endpoint | `supertest` + basic-auth via `spec/etapi/utils.ts` | [server-and-core.md](server-and-core.md) |
| Pure logic (parsers, formatters, math, data maps) | Plain Vitest, no harness | any reference |

## Running tests

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
- For provably-unreachable defensive branches, mark them with `/* v8 ignore next */` / `/* v8 ignore start */…/* v8 ignore stop */` and a one-line reason — don't delete the guard or write a fake test.

## Universal gotchas

- **`vi.mock` is hoisted** above imports. Put component/module imports *after* the `vi.mock(...)` calls; mock factories can't reference outer non-hoisted variables. Partial-mock with `async (importOriginal) => ({ ...(await importOriginal()), onlyThis: vi.fn() })`.
- **Don't assert on translated (i18n) strings** — assert structure/keys/behavior (classes, counts, ids), not human-readable English.
- **happy-dom is not a browser:** `getBoundingClientRect()` returns zeros, `ResizeObserver`/layout/visibility are stubs. Anything pixel/size/scroll-based needs `@vitest/browser`, not happy-dom.
- Reserve `@vitest/browser` (already a dependency, currently unconfigured) for real-layout/integration needs (CKEditor, Excalidraw, Modal transitions, size measurement) — not for normal unit tests.
