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
- **Internal API** (`apps/server/src/routes/api/*` + `packages/trilium-core/src/routes/api/*`): session cookie + CSRF. **This is the large uncovered surface.**

## Pattern 1 — internal REST API via supertest agent

Reuse the agent + CSRF flow from `apps/server/src/routes/api/options.spec.ts`. Start with read/transform handlers (`tree`, `recent_changes`, `note_map`, `similar_notes`, `stats`) — they need no setup beyond the seeded demo content. One spec file per handler keeps fork isolation clean.

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

**Mutations require CLS:** wrap `setContent`/`createNewNote`/etc. in `cls.init(() => ...)`. Supertest route tests get CLS for free; direct service calls do not.

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
2. `packages/trilium-core/src/routes/api/*` internal handlers (supertest) — untouched by ETAPI specs. Read handlers first, then `branches`/`cloning`/`bulk_action`/`attributes`.
3. `apps/server/src/services/anonymization.ts`, `totp.ts` (pure).
4. `packages/trilium-core/src/services/date_notes.ts`, `export/markdown.ts`, `import/enex.ts`, `special_notes.ts`.
5. `apps/server/src/services/llm/tools/*` + `request.ts`/`open_id.ts` (mocked).
6. Broaden ETAPI error-path assertions (low effort, harness exists).
