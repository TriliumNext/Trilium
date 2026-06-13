# Wrappers, conventions & the three call sites

Depth for the SKILL.md decision tables. Every claim cites a real file:line — line numbers drift, so re-open before quoting.

## 1. The four wrappers (`apps/server/src/routes/route_api.ts`)

```ts
// :66
export function apiRoute<P>(method, path, routeHandler /* sync */) {
    route(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}
// :70
export function asyncApiRoute<P>(method, path, routeHandler /* async */) {
    asyncRoute(method, path, [auth.checkApiAuth, csrfMiddleware], routeHandler, apiResultHandler);
}
// :74
export function route<P>(method, path, middleware, routeHandler, resultHandler = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, /* transactional */ true);
}
// :78
export function asyncRoute<P>(method, path, middleware, routeHandler, resultHandler = null) {
    internalRoute(method, path, middleware, routeHandler, resultHandler, /* transactional */ false);
}
```

| Wrapper | Handler signature (TS type) | Transaction (`internalRoute:97`) | Middleware | Result handler | Use for |
|---|---|---|---|---|---|
| `apiRoute` | `SyncRouteRequestHandler` — `(req,res,next) => object \| number \| string \| void \| null` (the `NotAPromise<object>` type **forbids** a Promise return) | `sql.transactional(cb)` — **synchronous** | fixed `[checkApiAuth, csrf]` | always `apiResultHandler` | sync read/write that returns a value |
| `asyncApiRoute` | `ApiRequestHandler` — `(req,res,next) => unknown` (Promise allowed) | `cb()` — no sync wrap | fixed `[checkApiAuth, csrf]` | always `apiResultHandler` | async handler returning a value |
| `route` | `SyncRouteRequestHandler` | `sql.transactional(cb)` | **explicit array** | optional (`null` ⇒ handler owns `res`) | direct-to-`res` (image/file), externally-called (setup/sync), custom mw |
| `asyncRoute` | `ApiRequestHandler` | `cb()` | **explicit array** | optional | async + multipart/streaming (import/export) |

### The synchronous-transactional footgun, in full (`internalRoute:82-98`)

```ts
const result = cls.init(() => {
    cls.set("componentId", req.headers["trilium-component-id"]);
    cls.set("localNowDateTime", req.headers["trilium-local-now-datetime"]);
    cls.set("hoistedNoteId", req.headers["trilium-hoisted-note-id"] || "root");
    const cb = () => routeHandler(req, res, next);
    return transactional ? sql.transactional(cb) : cb();   // :97
});
```

`sql.transactional(cb)` runs `cb` and commits **when `cb` returns**. If `cb` is `async` it returns a Promise immediately, so the commit fires before any `await` inside resolves — the transaction is empty and every subsequent write runs un-transacted. The downstream `if (result instanceof Promise) { result.then(...) }` (`:104`) still resolves the response correctly, which is why this is silent: the HTTP response looks fine, but durability/atomicity is gone. **That is why `asyncApiRoute` exists and threads `transactional=false`** — async work uses the promise path with no synchronous commit. The standalone adapter spells it out:

> `browser_routes.ts:127-132` — "Uses transactionalAsync (manual BEGIN/COMMIT/ROLLBACK) instead of the synchronous transactional() wrapper, which would commit an empty transaction immediately when passed an async callback."

TypeScript helps a little: `apiRoute`'s `SyncRouteRequestHandler` (`route_api.ts:24`) is typed `NotAPromise<object> | number | string | void | null`, so an `async` handler that returns `Promise<object>` is a type error at the registration site. Don't defeat it — switch to `asyncApiRoute`.

## 2. Return-value conventions (`apiResultHandler`, `route_api.ts:26-44`)

```ts
result = routes.convertEntitiesToPojo(result);                       // :29
if (Array.isArray(result) && result.length > 0 && Number.isInteger(result[0])) {
    const [statusCode, response] = result;                          // :33  [status, body] tuple
    // 200/201/204 are not logged; everything else is logged as a non-OK response (:35)
    return send(res, statusCode, response);                         // :39
} else if (result === undefined) {
    return send(res, 204, "");                                      // :41  nothing → 204
}
return send(res, 200, result);                                      // :43  object/array/string → 200
```

`send` (`:47`) sets `text/plain` for string bodies with status ≥ 400, else JSON. Errors thrown by the handler are caught in `internalRoute` and mapped by `handleException` (`:127`): `ValidationError`/`NotFoundError` → their `.statusCode`, anything else → 500.

| Return | Status | Notes |
|---|---|---|
| `{ ... }` / `[ ... ]` (non-int-first) / `"..."` | 200 | the common case |
| `undefined` (no `return`) | 204 | empty body |
| `[200, body]` | 200 | `branches.ts:42,90` — validation-failed-but-OK results |
| `[400, "msg"]` | 400 | `revisions.ts:115` |
| `[500, "msg"]` | 500 | `import.ts:83,87,137` |
| `throw new ValidationError("...")` | 400 | core `errors` (`branches.ts:27,278,283`) |
| `throw new NotFoundError("...")` | 404 | core `errors` |

## 3. `convertEntitiesToPojo` unwrap table (`index.ts:256-281`)

| Result shape | Unwrapped? | Line |
|---|---|---|
| top-level `AbstractBeccaEntity` | yes → `.getPojo()` | :257-258 |
| top-level `Array` of entities | yes, element-wise | :259-264 |
| `result.note` is an entity | yes | :266-267 |
| `result.branch` is an entity | yes | :270-271 |
| `result.executionResult` (from `runOnBackend()`) | yes, **recursively** | :275-277 |
| `result.notes[]`, `result.parentNote`, `result.attributes[]`, `result.attachment`, any other key | **NO** | — |

The function header comment is the warning: *"If entity is not caught, serialization to JSON will fail"* (`:255`). For an unrecognized shape, call `.getPojo()` when assembling the response, or nest under `note`/`branch`. (Handlers that return many notes typically map to plain objects already, e.g. tree/search build POJOs directly rather than returning live `BNote`s.)

## 4. One registration, three runtimes

`buildSharedApiRoutes` (`index.ts:58`) takes a context of injected helpers and registers ~140 routes against them. Each runtime supplies its own implementations of that context, so a single `apiRoute(...)` line lights up everywhere:

| Call site | File | What it injects | Auth/CSRF | Multipart |
|---|---|---|---|---|
| **Express server** | `apps/server/src/routes/routes.ts:81` | the real `route_api.ts` wrappers + `auth.*` middleware + `csrfMiddleware` + multer | enforced | real multer (`uploadMiddlewareWithErrorHandling`) |
| **Standalone (WASM)** | `apps/standalone/src/lightweight/browser_routes.ts:276` | `BrowserRouter`-bound wrappers; `transactional()` for sync, `transactionalAsync()` for async (`createAsyncRoute:133`); all auth/csrf/rate-limit are no-ops (`noopMiddleware:246`) | none (no network) | mock `req.file` |
| **CoreApiTester** | `packages/trilium-core/src/test/api_tester.ts:250` | in-process wrappers; `getContext().init` + `getSql().transactional`; `noop` middleware; first-match-wins routing | skipped by design | pass `file:` in `RequestOptions` |

Implications:

- **Standalone parity is automatic for core routes.** If your handler is browser-safe, registering in `index.ts` makes it work in standalone with zero extra code. If it isn't (Node-only dep), the WASM bundle breaks — that's the signal it belongs in `routes.ts` instead.
- **`CoreApiTester` is "supertest for core" with no socket.** `request()` (`api_tester.ts:266`) builds an Express-like `req`, matches `this.routes` in registration order (`:284`), runs the handler inside `getContext().init` + transaction, applies the same `convertEntitiesToPojo` + `[status,body]`/`undefined→204` formatting (`formatApiResult:98`), JSON-round-trips the body, and maps thrown `HttpError`→status (`:318`). It deliberately skips auth/CSRF/rate-limit/multipart middleware (`api_tester.ts:26-30`) — those are Express concerns, covered by supertest.
- **Ordering is shared.** Because `CoreApiTester.request` returns on first match (`:316`), a literal-vs-`:param` collision misbehaves identically in tests and in Express — so a `CoreApiTester` spec will actually catch an ordering bug.
- **The standalone `apiResultHandler` (`browser_routes.ts:222`) drops the tuple status code** (`const [_statusCode, response] = result; res.result = response;`) — it captures only the body, since the BrowserRouter conveys status separately. Don't rely on the HTTP status surfacing through that adapter the way it does on Express; assert behavior via `CoreApiTester` (which *does* preserve the tuple status in `formatApiResult:104-106`) and the supertest transport spec.

## 5. Browser-safe checklist for core handlers

| Don't | Do | Why |
|---|---|---|
| `process.env.FOO` | `getPlatform().getEnv("FOO")` | no `process` in WASM (`script.ts:75,86` is a latent violation) |
| `import path from "path"` / `node:path` | `extname`/`basename` from `packages/trilium-core/src/services/utils/path.ts` (`:7`, `:15`) | `path` is externalized in the browser build |
| any `node:*` built-in | a platform provider or a portable util | core runs in Node **and** the browser |

See `CLAUDE.md` → "Platform Abstraction" and "Critical rules for `trilium-core`" for the full list.
