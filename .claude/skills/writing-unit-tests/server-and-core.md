# Testing the server & trilium-core (`apps/server/`, `packages/trilium-core/`)

`apps/server/spec/setup.ts` boots an **in-memory SQLite fixture** once per spec file: it loads `packages/trilium-core/src/test/fixtures/document.db` (password **`demo1234`**) and calls `initializeCore(...)`. With `pool: "forks"`, each spec file gets a fresh writable copy — **mutations isolate per file, not per `it()`**.

`trilium-core` cannot run tests standalone (its `test` script just prints a note — it needs a host runtime's platform providers). Its specs run **through** `apps/server` (and `apps/standalone`), which list `../../packages/trilium-core/src/**` in their test `include`. For that core code to actually count toward coverage, each host also sets `coverage.allowExternal: true` and lists core in `coverage.include` (v8 drops out-of-root files otherwise — see the coverage rules in `SKILL.md`). Add core specs next to the core source or under `apps/server/spec` — both feed the same coverage number, reported under the `server`/`standalone` Codecov flags. A dedicated core vitest project is **not** needed.

### ⚠️ A core spec runs under BOTH runtimes — verify both before calling it done
The same `packages/trilium-core/src/**` spec executes under the **server** suite (vitest env `node`, better-sqlite3 + `NodejsCryptoProvider`) **and** the **standalone** suite (env `happy-dom`, sql.js WASM + `Browser*Provider`). Passing `pnpm --filter server exec vitest run <spec>` is **not enough** — also run `pnpm --filter standalone exec vitest run <spec>`. A spec green on server can fail on standalone because the providers differ. Known cross-runtime traps:
- **`BNote.getContent()` of a non-string note** is a `Buffer` on Node (`.toString()` → UTF-8) but a `Uint8Array` on WASM (`.toString()` → `"40,40,..."`). Decode portably: `unwrapStringOrBuffer(note.getContent())` (import from a **relative** path like `./utils/binary.js`, never `@triliumnext/core` — self-import fails inside core).
- **Provider implementation details differ** and are NOT cross-runtime contracts: e.g. better-sqlite3 caches raw vs non-raw statements as distinct objects (sql.js may not); `crypto.hmac` of `Uint8Array` vs `string` inputs differs on Node but not in the browser provider. Don't assert these — assert the portable contract.
- **Capability gaps**: `getSql().serialize()` throws on better-sqlite3 (Node) but works on sql.js (WASM); `BrowserZipProvider.createFileStream()` throws (no file streams in the browser) and its streaming/finalize model differs (Node-style `pipe`→`end` never fires). For genuinely runtime-specific behavior, gate with `const isBrowserRuntime = typeof window !== "undefined";` + `it.skipIf(isBrowserRuntime)` / `describe.skipIf(...)` and a one-line reason — but prefer a portable assertion or capability-aware branch over skipping when the behavior is actually the same.

There are **two distinct HTTP code paths** — testing one does not cover the other:
- **ETAPI** (`apps/server/src/etapi/*`): basic-auth token, helpers in `spec/etapi/utils.ts`.
- **Internal API**: the `apps/server/src/routes/api/*` Express wrappers, plus the **shared core handlers** in `packages/trilium-core/src/routes/api/*` (registered by `buildSharedApiRoutes`). The shared core handlers are driven cross-runtime by `CoreApiTester` (Pattern 0); the thin Express transport on top is covered by supertest (Pattern 1).

**Where spec files live:** internal-API and core route tests are **co-located with their module** — `apps/server/src/routes/api/<module>.spec.ts` for the thin Express transport, `packages/trilium-core/src/routes/api/<module>.spec.ts` for the shared core handler. **ETAPI is the exception**: its specs live under `apps/server/spec/etapi/` (with the `spec/etapi/utils.ts` helpers). Don't park internal `/api/*` tests in `spec/` — e.g. the metrics endpoint test belongs at `src/routes/api/metrics.spec.ts`, next to `metrics.ts`, not in `spec/etapi/`.

## Pattern 0 — the cross-runtime core route driver (`CoreApiTester`) — PREFER THIS for core routes

For specs under `packages/trilium-core/src/routes/api/*.spec.ts`, use the in-process, transport-agnostic driver `packages/trilium-core/src/test/api_tester.ts`. It registers the exact handlers from `routes.buildSharedApiRoutes` and runs them **without Express/HTTP**, so the same spec runs under **both** the node (better-sqlite3) and standalone (sql.js WASM) suites. It exercises the real lifecycle: param/query parsing, cls + SQL transaction wrapping, `convertEntitiesToPojo`, the `[status, body]`/`undefined→204` conventions, `HttpError`→status mapping, and JSON round-tripping. It deliberately skips platform middleware (auth/CSRF/rate-limit/multipart) — those are server concerns (Pattern 1).

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;
describe("X API (core)", () => {
    beforeAll(() => { api = CoreApiTester.build(); });
    it("...", async () => {
        const res = await api.get("/api/...", { query: { q: "1" } }); // also post/put/patch/delete
        expect(res.status).toBe(200);          // → { status, headers, body }
    });
});
```
- `api.<verb>(path, { body, query, headers, file })`. `createTextNote(api, {...})` → `{ noteId, branchId }`. Assert real state via `getSql()` / `becca`.
- Mutations are auto-wrapped in cls + a SQL transaction — **no `cls.init` needed** (unlike Pattern 3 direct service calls).
- Header-reading handlers (e.g. sync) work: pass `headers` and the handler's `req.get(name)` reads them case-insensitively.

### It runs REAL services end to end — including streaming + multipart. Don't mock them.
Both test setups (`apps/server/spec/setup.ts`, `apps/standalone/src/test_setup.ts`) inject the **real platform providers** (zip = archiver/fflate, image = sharp/magic-bytes, backup = fs/OPFS), and **both vitest suites run on Node** (the standalone setup itself imports `node:fs`/`node:module`) — so `Buffer`, `node:stream`, `node:fs` are available in either runtime. The tester's mock `res` is a real Node `Writable` that also implements the Express surface (`set`/`setHeader`/`removeHeader`/`status`/`send`/`sendStatus`/`write`/`end`), so the **server** export path (`archiver.pipe(res)`, needs a real writable) and the **browser** path (`BrowserZipArchive.finalize()` → `res.send(bytes)`) both run. Match the ETAPI **zero-mock** convention: drive real inputs and assert real output.
- **Multipart**: pass `file: { originalname, mimetype, buffer: Buffer.from(...) }` — the real import/image handlers run.
- **Binary/streamed response bodies** come back as a `Buffer` (real zips start with `PK`); text as a string; JSON as an object.
- **Need a real zip cross-runtime?** Export→import round-trip: `const zip = await api.get(\`/api/branches/${"<branchId>"}/export/subtree/html/t\`)` gives a real zip `Buffer` in `zip.body`; feed it back to `.../notes-import` as the `file.buffer`.

### When a core route still needs a *targeted* mock (the genuine exceptions)
Only where the platform op can't run against the ephemeral test env — keep it minimal and documented, and prefer `vi.spyOn(importedServiceObject, "method")` over `vi.mock`:
- **backup**: better-sqlite3 `.backup()` rejects `SQLITE_NOTADB` against the in-memory fixture (node) and there's no OPFS in happy-dom (standalone) → spy `backupNow`/`getBackupContent`; keep `getExistingBackups` + 400/404 real.
- **sync** `testSync`/`syncNow`/`forceFullSync`: real network → spy `syncService.login`/`sync`. `getChanged`/`update`/`checkSync` run real.
- **setup** `createInitialDatabase`/`createDatabaseForSync`: they wipe/replace the DB → spy them.
- A genuinely runtime-specific path (e.g. backup download needs the file on disk, node-only): gate with `it.skipIf(typeof window !== "undefined")` + a one-line reason; the line still counts via the node suite.

## Pattern 1 — Express transport / middleware via supertest agent

Use this only for what exists *because of* Express and can't be reached by Pattern 0: CSRF enforcement, auth, multipart wiring, and that core routes are wired into the app end to end. See `apps/server/src/routes/api/core_routes_http.spec.ts` (boots the real app via `bootLoggedInApp()` in `spec/support/internal_api.ts`).

Reuse the agent + CSRF flow from `apps/server/src/routes/api/options.spec.ts` (or `bootLoggedInApp()`). Keep these specs thin — per-handler behaviour belongs in Pattern 0; here you assert only the transport (e.g. a mutating request without `x-csrf-token` → 403, a GET served end to end). One spec file per `beforeAll` boot keeps fork isolation clean.

```ts
import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Application, agent: ReturnType<typeof supertest.agent>, csrfToken: string;

describe("Tree API", () => {
    beforeAll(async () => {
        app = await (await import("../../app.js")).default();
        agent = supertest.agent(app);
        await agent.post("/login").send({ password: "demo1234" }).expect(302);
        csrfToken = (await agent.get("/bootstrap").expect(200)).body.csrfToken;
    });
    it("loads the tree rooted at root", async () => {
        const res = await agent.post("/api/tree/load").set("x-csrf-token", csrfToken)
            .send({ subTreeNoteId: "root", noteIds: ["root"] }).expect(200);
        expect(res.body.notes.some((n: any) => n.noteId === "root")).toBe(true);
    });
});
```

## Pattern 2 — ETAPI contract via supertest + basic auth

Use `spec/etapi/utils.ts` (`login`, `createNote`). The suite is mature on happy paths — the cheap wins are **error/edge paths** (404 missing id, 400 malformed body, validation rejection), which exercise the shared etapi handlers/validators currently only hit on success.

```ts
it("returns 404 for a non-existent note", async () => {
    await supertest(app).get("/etapi/notes/doesNotExist123/content")
        .auth("etapi", token, { type: "basic" }).expect(404);
});
```

## Pattern 3 — real-DB service test (write paths)

For the big write-path files (`notes.ts` is the largest cold file, 1303 lines), test **against the real in-memory DB**, not with sql stubbed — stubbing only covers pure helpers and leaves the shipping SQL/cache/entity-change path cold. Follow `apps/server/src/services/hidden_subtree.spec.ts`:

```ts
import { becca, cls, note_service as notes } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";
import sql_init from "./sql_init.js";

describe("createNewNote (real DB)", () => {
    beforeAll(async () => { sql_init.initializeDb(); await sql_init.dbReady; });
    it("creates a text note under root with content + branch", () => {
        const { note, branch } = cls.init(() => notes.createNewNote({
            parentNoteId: "root", title: "Spec note", content: "<p>hello</p>", type: "text"
        }));
        expect(becca.notes[note.noteId]).toBe(note);
        expect(note.getContent()).toBe("<p>hello</p>");
        expect(branch.parentNoteId).toBe("root");
    });
});
```

**Mutations require CLS** — wrap `setContent`/`createNewNote`/`BAttribute.save()`/etc. (anything that emits an entity change or opens a transaction) in a CLS context, or they throw. Supertest route tests and `CoreApiTester` (Pattern 0) get CLS for free; direct service/entity calls do not.
- **In `apps/server` specs**, use `cls.init(() => ...)` from `@triliumnext/core` (as above).
- **In `packages/trilium-core/src/**` specs** (which run cross-runtime and must NOT self-import `@triliumnext/core`), import `getContext` from a relative `context.js` and call it inline: `import { getContext } from "../services/context.js";` then `getContext().init(() => ...)`, or `await getContext().init(async () => { ... })` for async work (`init` returns the callback's promise, so awaiting and throwing propagate normally). See `import/enex.spec.ts` / `import/single.spec.ts` for the inline async form.
- **Do NOT wrap this in a per-file helper.** A local `withContext(fn)` that just does `return getContext().init(fn)` is a pointless duplicate of the existing `getContext().init` / `cls.init` export — and because specs get written file-by-file, that wrapper once metastasised into 35 identical copies before being removed. Call `getContext().init(...)` / `cls.init(...)` directly at the call site.

## Pattern 4 — pure service, zero infra

Cheapest wins: services that are deterministic string/data builders with no DB. `apps/server/src/services/anonymization.ts`, `totp.ts`. Lock the output like `blob.spec.ts` locks a hash; extract inner builders if not exported (per `CLAUDE.md`'s "extract and test business logic").

## Pattern 5 — mock external SDKs

For network/AI/OCR code, two proven idioms:
- `vi.mock` the SDK directly: `tesseract.js` (see `ocr/ocr_service.spec.ts`), `@ai-sdk/*` + `ai` (use `vi.hoisted`).
- **Partial-mock `@triliumnext/core`** to override only what you need:

```ts
const mockBecca = { getNote: vi.fn(), notes: {} as Record<string, any> };
vi.mock("@triliumnext/core", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@triliumnext/core")>()),
    becca: mockBecca
}));
```

Target the `mutates:false` `execute()` of LLM tools (`llm/tools/*`). Don't try to test actual model/OCR output. **Mock-path correctness:** production imports `becca`/`sql`/`options`/`getLog` from `@triliumnext/core` directly (the old `apps/server/src/services/*` wrappers were removed), so mock `@triliumnext/core`, not the old wrapper paths.

## Server gotchas

- **Fork isolation is per file**, and `it()`s share the DB within a file. Order-dependent tests inside a file can interfere; re-establish a baseline before rollback tests (`options.spec.ts` does this).
- **becca goes stale vs the DB on rollback** — becca is mutated *before* the SQL write and left stale after a rollback. When testing transaction/rollback behavior, assert against the DB row (`getSql().getRowOrNull(...)`), not becca.
- `llm/providers/*` and `ocr/*` need heavy SDK mocking; the existing provider specs assert construction/message-shape invariants, not inference. `open_id.ts`/`request.ts` hit the network — mock the transport.

## Best ROI targets

1. `packages/trilium-core/src/services/notes.ts` (real-DB) — largest cold file; also pulls in blob hashing, entity_changes, saveLinks.
2. ~~`packages/trilium-core/src/routes/api/*` internal handlers~~ — **done**: all at 100% lines via `CoreApiTester` (Pattern 0). If extending, follow that pattern and keep it mock-free.
3. `apps/server/src/services/anonymization.ts`, `totp.ts` (pure).
4. `packages/trilium-core/src/services/date_notes.ts`, `export/markdown.ts`, `import/enex.ts`, `special_notes.ts`.
5. `apps/server/src/services/llm/tools/*` + `request.ts`/`open_id.ts` (mocked).
6. Broaden ETAPI error-path assertions (low effort, harness exists).
