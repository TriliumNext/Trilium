---
name: adding-internal-api-route
description: Use when adding, moving, or wiring an internal REST endpoint in Trilium (a new `/api/*` route) — choosing between a core-shared handler (`packages/trilium-core/src/routes/index.ts` `buildSharedApiRoutes`, ~140 routes that ALSO run in the standalone sql.js WASM build) and a server-only one (`apps/server/src/routes/routes.ts`), picking the `apiRoute` vs `asyncApiRoute` vs `route`/`asyncRoute` wrapper, and getting the implicit return conventions (object→200, `undefined`→204, `[status, body]` tuple→that status) and `convertEntitiesToPojo`'s narrow entity-unwrapping right. Most routes are core-shared (and run under WASM); `apps/server/src/routes/api/` is the minority case. Pairs with writing-unit-tests for the cross-runtime CoreApiTester spec.
---

# Adding an internal API route in Trilium

**The first decision is which `routes/api/` directory.** There are **TWO**, and the common assumption that all routes live server-side in `apps/server/src/routes/api/` is wrong — that's the *minority* case. ~140 of the routes live in the **core** one:

| Directory | Wired by | Runs in | Testable by |
|---|---|---|---|
| **`packages/trilium-core/src/routes/api/*`** (default, ~140 routes) | `buildSharedApiRoutes` in [`packages/trilium-core/src/routes/index.ts:58`](../../../packages/trilium-core/src/routes/index.ts) | server **+ desktop + standalone WASM** | `CoreApiTester` (cross-runtime) **and** supertest |
| `apps/server/src/routes/api/*` (server-only) | `register()` in [`apps/server/src/routes/routes.ts:51`](../../../apps/server/src/routes/routes.ts) | server + desktop only | supertest only |

A route you add only in `routes.ts` is **invisible to the standalone build and cannot be driven by `CoreApiTester`**. A core handler that imports `node:*` or touches `process.env` **breaks the WASM build**. Pick the wrong side and you either lose standalone support or break it.

## Footgun checklist (read before you start)

1. **Default to core.** Note/branch/attribute/tree/search/revision/import logic is browser-safe → put it in `packages/trilium-core/src/routes/api/` and register in `index.ts`'s `buildSharedApiRoutes`. Only Node-only or genuinely server-scoped routes go in `routes.ts`. (Step 1.)
2. **Async handler ⇒ `asyncApiRoute`, never `apiRoute`.** `apiRoute` runs `sql.transactional(cb)` **synchronously** ([`route_api.ts:97`](../../../apps/server/src/routes/route_api.ts)) — hand it an async function and it commits an empty transaction *immediately*; your awaited writes land outside any transaction. (Step 2.)
3. **Return conventions are implicit.** object/array/string → `200`; `undefined`/nothing → `204`; `[integerStatus, body]` tuple → that status. Throw `ValidationError`/`NotFoundError` for 400/404. (Step 3.)
4. **`convertEntitiesToPojo` only unwraps narrow shapes.** A `BNote` nested under `result.notes[]`, `result.parentNote`, `result.attributes[]` serializes raw/broken — call `.getPojo()` yourself or shape under `note`/`branch`. (Step 4.)
5. **Core handlers must be browser-safe:** no `process.env` (use `getPlatform().getEnv()`), no `node:path`/`import path` (use [`services/utils/path.ts`](../../../packages/trilium-core/src/services/utils/path.ts) `extname`/`basename`), no Node built-ins.
6. **Registration order matters cross-runtime** — register a literal path before a same-method `:param` catch-all on the same prefix. (Step 5.)
7. **Don't write the test by hand** — core route ⇒ `CoreApiTester`; Express transport ⇒ supertest. Hand off to the **writing-unit-tests** skill. (Step 6.)

## Step 1 — Decide: core-shared vs server-only

| Put the handler in… | When |
|---|---|
| **core** `packages/trilium-core/src/routes/api/<m>.ts` + register in `index.ts` `buildSharedApiRoutes` | logic uses only browser-safe deps (`becca`, `getSql()`, core services, platform providers) AND the feature should work in standalone. **Default** for note/branch/attribute/tree/search/etc. |
| **server-only** `apps/server/src/routes/api/<m>.ts` + register in `routes.ts` `register()` | needs Node-only deps not behind a platform provider (multer fs paths, OCR/LLM SDKs, metrics, sender, electron), or is genuinely server-scoped (etapi-tokens, totp, recovery codes) |

The server-only set is small and specific — clipper, database, llm_chat, ocr, metrics, sender, totp, fonts, link_embed, recovery_codes, system_info, etapi_tokens, plus a few `files` extras. See `routes.ts:96-202`. Everything else is core.

**Browser-safe rule for core handlers:** no `process.env`, no `node:path`/`import path`, no Node built-ins — they run in the sql.js WASM standalone build. (`script.ts:75,86` reads `process.env.TRILIUM_SAFE_MODE` directly — that is a **latent violation**, not a pattern to copy.)

## Step 2 — Pick the wrapper

All four wrappers live in [`apps/server/src/routes/route_api.ts`](../../../apps/server/src/routes/route_api.ts) (`apiRoute:66`, `asyncApiRoute:70`, `route:74`, `asyncRoute:78`). Their names arrive via the `buildSharedApiRoutes` context object, so **registering once in `index.ts` auto-wires all three call sites** (server `routes.ts:81`, standalone `browser_routes.ts:276`, `api_tester.ts:250`).

| Wrapper | Handler shape | Transaction | Auth + CSRF | Result handling |
|---|---|---|---|---|
| `apiRoute(method, path, h)` | **synchronous** `(req) => value` | `sql.transactional` (**sync**) | `checkApiAuth` + csrf, auto | `apiResultHandler` |
| `asyncApiRoute(method, path, h)` | **async** `(req) => Promise` | async (no sync wrap) | `checkApiAuth` + csrf, auto | `apiResultHandler` |
| `route(method, path, [mw], h, resultHandler?)` | sync; writes `res` directly OR custom `[mw]` (image/file download, setup, sync) | sync | **explicit** `[mw]` | optional |
| `asyncRoute(method, path, [mw], h, resultHandler?)` | async + explicit `[mw]` (import/export, multipart) | async | **explicit** `[mw]` | optional |

**The sync-transactional trap (`route_api.ts:97`):**

```ts
return transactional ? sql.transactional(cb) : cb();
```

`apiRoute` → `route(...true)` → `internalRoute(..., transactional=true)`; `asyncApiRoute` → `asyncRoute(...false)` → `transactional=false`. So `apiRoute` calls `sql.transactional(cb)` **synchronously**. If `cb` is `async`, `sql.transactional` sees a returned Promise, commits the (empty) transaction, and your `await`ed writes run *after* the commit, outside any transaction. The standalone adapter documents this exact trap in `browser_routes.ts:127-132` ("would commit an empty transaction immediately when passed an async callback"). **Async handler ⇒ `asyncApiRoute`. Always.**

**Auth/CSRF:** `apiRoute`/`asyncApiRoute` attach `auth.checkApiAuth` + `csrfMiddleware` automatically (`route_api.ts:67,71`). Mutating endpoints therefore carry CSRF for free. Routes called from outside a browser session (setup, sync, sender, image/file download) use bare `route()`/`asyncRoute()` with an explicit `[middleware]` array (often `checkApiAuthOrElectron` or `checkApiAuth`) — see `index.ts:126-149` and `routes.ts:142-176`.

## Step 3 — Return value conventions

From `apiResultHandler` ([`route_api.ts:26-44`](../../../apps/server/src/routes/route_api.ts)), mirrored by the standalone `apiResultHandler` (`browser_routes.ts:222`) and `CoreApiTester.formatApiResult` (`api_tester.ts:98`):

| Your handler returns… | HTTP status | Real example |
|---|---|---|
| object / array / string | `200` | most handlers |
| `undefined` / nothing | `204` | `branches.ts` `setPrefix`, `setExpanded` |
| `[integer, body]` (first elem is an int) | that status code | `branches.ts:42,90` `[200, …]`; `import.ts:83,87,137` `[500, msg]`; `revisions.ts:115` `[400, "Description must be a string."]` |
| `throw new ValidationError(...)` / `NotFoundError(...)` | `400` / `404` | mapped by `handleException` (`route_api.ts:137`); `CoreApiTester` maps `HttpError`→status at `api_tester.ts:318` |

Direct-response handlers (image/download) write to `res` themselves and use `route()`, not `apiRoute()` — see `index.ts:126-128`, `files` routes `index.ts:224-232`.

## Step 4 — Entity serialization (`convertEntitiesToPojo`)

[`index.ts:256-281`](../../../packages/trilium-core/src/routes/index.ts) only unwraps `AbstractBeccaEntity` instances in **five** shapes:

1. the **top-level** result is an entity (`:257`)
2. the **top-level** result is an **array** of entities (`:259-264`)
3. `result.note` (`:266-267`)
4. `result.branch` (`:270-271`)
5. (recursively) `result.executionResult`, from `runOnBackend()` (`:275-277`)

**Anything else serializes raw.** A `BNote` under `result.notes[]`, `result.parentNote`, `result.attributes[]`, `result.attachment`, or any other key is **not** unwrapped — `JSON.stringify` then ships the live entity (lazy getters, becca back-references) and the response is wrong or throws. Fix: call `.getPojo()` yourself when building the response, or place the entity under a recognized `note`/`branch` key. `createTextNote` relies on this: the create handler returns `{ note, branch }` and both get unwrapped.

## Step 5 — Registration order

Both Express **and** `CoreApiTester` match in **registration order, first match wins** — the tester iterates `this.routes` and returns on the first match (`api_tester.ts:284-316`). Register a literal path *before* a same-method `:param` catch-all on the same prefix. Precedent (etapi side): `routes.ts:188` — "Register revisions routes BEFORE notes routes so /etapi/notes/history is matched before /etapi/notes/:noteId". Current core `/api/notes/...` literals avoid collisions only because they differ by HTTP method (e.g. `POST /api/notes/erase-deleted-notes-now` vs `GET /api/notes/:noteId`) — if you add a literal that shares a method with an existing `:param` route on the same prefix, **put the literal first**.

## Step 6 — Test it (handoff, don't reinvent)

Don't hand-roll a route test. Use the existing harness:

| What you added | Test with | Where |
|---|---|---|
| **core** handler | `CoreApiTester.build()` ([`packages/trilium-core/src/test/api_tester.ts`](../../../packages/trilium-core/src/test/api_tester.ts)) | co-located `packages/trilium-core/src/routes/api/<m>.spec.ts` — runs under **both** server and standalone suites |
| Express transport (CSRF/auth wiring) | supertest agent + `bootLoggedInApp()` | `apps/server/src/routes/api/core_routes_http.spec.ts` |
| **server-only** route | supertest agent | co-located `apps/server/src/routes/api/<m>.spec.ts` |

Minimal core spec (full patterns + fixtures live in the **writing-unit-tests** skill, `server-and-core.md` Pattern 0/1 — reference it, don't restate):

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;
describe("Widget API (core)", () => {
    beforeAll(() => { api = CoreApiTester.build(); });
    it("returns the widget", async () => {
        const note = await createTextNote(api, { title: "Source" });
        const res = await api.get(`/api/widgets/${note.noteId}`);
        expect(res.status).toBe(200);
    });
});
```

`createTextNote(api, {...})` → `{ noteId, branchId }` lives in `packages/trilium-core/src/test/api_fixtures.ts`. A core spec runs cross-runtime — **run both suites** before calling it done (`pnpm --filter server exec vitest run <spec>` AND `pnpm --filter standalone exec vitest run <spec>`); the providers differ. See **writing-unit-tests** for the cross-runtime traps and the Windows/sandbox vitest invocation.

## Quick recipe (core route, the common case)

1. Write `getX`/`putX` in `packages/trilium-core/src/routes/api/<m>.ts` as a **sync** `(req) => value` (or `async` if it awaits) handler; default-export the object of handlers.
2. Add the registration line to `buildSharedApiRoutes` in `index.ts` — `apiRoute(GET, "/api/...", <m>Route.getX)` for sync, `asyncApiRoute(...)` for async. That single line wires server + desktop + standalone + `CoreApiTester`.
3. Return a value (Step 3); keep it browser-safe (Step 1); unwrap entities under `note`/`branch` or via `.getPojo()` (Step 4); mind ordering (Step 5).
4. Add a co-located `<m>.spec.ts` with `CoreApiTester` and run both suites (Step 6).

## Reference map

| File | What it covers |
|---|---|
| [references/wrappers-and-conventions.md](references/wrappers-and-conventions.md) | Full wrapper matrix (handler shape, sync vs async transaction, middleware, result handler), the return-value table with real call sites, the `convertEntitiesToPojo` unwrap table, and how the three `buildSharedApiRoutes` call sites (Express `route_api.ts`, standalone `browser_routes.ts`, `CoreApiTester` `api_tester.ts`) each implement the same context. |

**Related skills:** **writing-unit-tests** (`server-and-core.md` Pattern 0 = `CoreApiTester`, Pattern 1 = supertest transport) for testing; **analyzing-coverage** for chasing the new handler's coverage.
