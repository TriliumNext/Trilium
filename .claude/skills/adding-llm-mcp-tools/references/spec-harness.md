# Spec harness for LLM/MCP tools

Tools are tested in-source: `apps/server/src/services/llm/tools/<name>_tools.spec.ts`, run by the server Vitest suite (`pnpm --filter server test src/services/llm/tools/note_tools.spec.ts`). The suite's `spec/setup.ts` (`vite.config.mts:11` → `setupFiles: ["./spec/setup.ts"]`) calls `initializeCore` with the fixture DB `packages/trilium-core/src/test/fixtures/document.db`, which is **pre-seeded with `root` and the hidden subtree**. That is why Pattern B can `createNewNote({ parentNoteId: "root" })` without seeding the tree itself.

There is **no Express route in tests**, so nothing supplies CLS automatically. You have exactly two choices — pick one, don't half-mock:

- **Pattern A — mock the persistence** (`note_tools.spec.ts`). Nothing hits the DB, so no CLS is needed.
- **Pattern B — real becca + `cls.init`** (`attribute_tools.spec.ts`, `hierarchy_tools.spec.ts`). Writes hit the seeded in-memory DB, so every seeding call and every executing call must be wrapped in `cls.init(...)`.

## The shared `getTool()` helper (copy verbatim)

Every spec re-declares this tiny iterator over its own registry (`note_tools.spec.ts:25-30`, `attribute_tools.spec.ts:7-12`, `hierarchy_tools.spec.ts:7-12`):

```ts
import { noteTools } from "./note_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of noteTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}
```

Then call `getTool("set_note_content").execute({ ... })` directly — no transaction wrapper, no `toToolSet()`. You're testing the raw `execute`; the `mutates`/CLS wrapping is the consumers' job and is covered separately.

## Pattern A — mock persistence (no CLS)

Use when the tool only reads/writes a single note's content via `setContent`/`saveRevision`, or calls a service you can mock (`createNewNote`). `vi.mock` is **hoisted above imports**, so the mock factory and any `vi.hoisted` mocks come before the module import. Seed notes with `becca_easy_mocking.buildNote` and reset becca in `beforeEach`.

```ts
import { becca, becca_easy_mocking } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteTools } from "./note_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

const { buildNote } = becca_easy_mocking;

// vi.hoisted lets the (hoisted) vi.mock factory reference this mock.
const findResultsMock = vi.hoisted(() => vi.fn());

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        note_service: { createNewNote: vi.fn() },
        search: { ...actual.search, findResultsWithQuery: findResultsMock }
    };
});

function getTool(name: string): ToolDefinition {
    for (const [n, def] of noteTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

// Give a built note an in-memory content store so the tool can read back what
// it wrote via setContent, and no-op saveRevision (note_tools.spec.ts:36-43).
function withMutableContent(note: ReturnType<typeof buildNote>, initial: string) {
    let store = initial;
    note.getContent = () => store;
    note.setContent = vi.fn((content: string | Uint8Array) => {
        store = typeof content === "string" ? content : new TextDecoder().decode(content);
    }) as typeof note.setContent;
    note.saveRevision = vi.fn() as typeof note.saveRevision;
}

describe("note_tools", () => {
    beforeEach(() => {
        becca.reset();
        vi.clearAllMocks();
    });

    it("set_note_content returns the new content for code notes", () => {
        const note = buildNote({ id: "code1", type: "code", mime: "text/plain", content: "old" });
        withMutableContent(note, "old");

        const result = getTool("set_note_content").execute({ noteId: "code1", content: "new code" });

        expect(result).toEqual({ success: true, noteId: "code1", title: note.title, content: "new code" });
    });

    it("set_note_content reports a missing note (and leaks no content)", () => {
        const result = getTool("set_note_content").execute({ noteId: "missing", content: "x" });
        expect(result).toEqual({ error: "Note not found" });
    });
});
```

Mocking a throwing service to exercise the try/catch branch (`note_tools.spec.ts:263-277`):

```ts
const { note_service: noteService } = await import("@triliumnext/core");
vi.mocked(noteService.createNewNote).mockImplementationOnce(() => { throw new Error("disk full"); });
expect(getTool("create_note").execute({ parentNoteId: "tparent", title: "T", content: "x", type: "text" }))
    .toEqual({ error: "disk full" });
```

To exercise a guard, mutate the built note directly: `note.isContentAvailable = () => false` (protected), `buildNote({ type: "image" })` (non-string content → `hasStringContent()` false), or `note.hasStringContent = () => true; note.getContent = () => new Uint8Array([1,2,3])` (binary holder).

## Pattern B — real becca + `cls.init` (the seeded DB)

Use when the tool drives real attribute/branch/note services (`setAttribute`, `createNewNote`, `cloneNoteToBranch`, `move`). No `vi.mock` of core. **Both** the seeding call and the executing call need `cls.init` because each one writes and therefore needs a CLS context (`attribute_tools.spec.ts:14-22,77`; `hierarchy_tools.spec.ts:14-21,99,160`).

```ts
import { becca, cls, note_service as noteService } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import { attributeTools } from "./attribute_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of attributeTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

// Create a real note under the seeded "root" — note the cls.init wrapper.
function createNote(title: string) {
    return cls.init(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content: "body",
        type: "text"
    }).note);
}

describe("attribute_tools", () => {
    it("set_attribute creates a label on a note", () => {
        const note = createNote("Set label host");

        const result = cls.init(() => getTool("set_attribute").execute({
            noteId: note.noteId, type: "label", name: "priority", value: "high"
        }));

        expect(result).toEqual({
            success: true, noteId: note.noteId, type: "label", name: "priority", value: "high"
        });
        expect(note.getLabelValue("priority")).toBe("high");
    });

    it("set_attribute rejects a protected note", () => {
        const note = createNote("Protected set host");
        note.isProtected = true;
        expect(cls.init(() => getTool("set_attribute").execute({
            noteId: note.noteId, type: "label", name: "x"
        }))).toMatchObject({ error: expect.stringContaining("protected") });
        note.isProtected = false; // restore — the becca note persists across the file
    });
});
```

Notes on Pattern B:
- **Guard a protected note** by flipping `note.isProtected = true` on a real becca note, asserting, then restoring it (the in-memory note lives for the whole file).
- **Validation-failure branches** (cycle on move, duplicate clone) return an `error` whose exact text comes from the service — assert structurally, not on the string: `expect(result).toHaveProperty("error"); expect(result).not.toHaveProperty("success")` (`hierarchy_tools.spec.ts:149-150,201-202`).
- **`beforeAll` seeding** is fine for read-only tools that share one host note (`attribute_tools.spec.ts:27-34`); per-`it` `createNote` is cleaner when each test mutates.

## Assertion style

- Error branch: assert the **literal object** — `toEqual({ error: "Note not found" })` for fixed messages, `toMatchObject({ error: expect.stringContaining("protected") })` for interpolated/service messages.
- Success branch: assert the returned shape **and** that it does not leak an `error` (and, where relevant, that a rejected edit leaks no `content`): `expect(result).not.toHaveProperty("error")`.
- Don't assert on Markdown/HTML round-trip output verbatim — use `expect(content).toContain("...")`, since the import/export round-trip normalizes formatting.
- **No non-null `!`** in your assertions (project rule). The existing `attribute_tools.spec.ts:138` uses `.find(...)!` — do not copy that; narrow with a null check or capture after `expect(x).toBeDefined()` instead.

See **writing-unit-tests** for the broader server-test setup (`sql_init` + `cls.init`, mocked-becca vs real-DB tradeoffs) and **analyzing-coverage** for driving the spec to 100%.
