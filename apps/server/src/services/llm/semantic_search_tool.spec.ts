import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteMock, notesStore, embedQueryMock, getNoteEmbeddingsMock, getOllamaBaseUrlMock } = vi.hoisted(() => ({
    getNoteMock: vi.fn(),
    notesStore: {} as Record<string, unknown>,
    embedQueryMock: vi.fn(),
    getNoteEmbeddingsMock: vi.fn(),
    getOllamaBaseUrlMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, getNote: getNoteMock, notes: notesStore },
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

vi.mock("./tools/helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./tools/helpers.js")>();
    return {
        ...actual,
        // The real preview goes through becca blobs, which aren't loaded in unit tests.
        getContentPreview: (note: { title: string }) => `preview of ${note.title}`
    };
});

vi.mock("./embeddings.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./embeddings.js")>();
    return {
        ...actual,
        embedQuery: embedQueryMock,
        getNoteEmbeddings: getNoteEmbeddingsMock,
        getOllamaBaseUrl: getOllamaBaseUrlMock
    };
});

import { addSemanticSearchTool } from "./semantic_search_tool.js";

/** A candidate note stub with everything isCandidate() and the result mapper touch. */
function noteStub(noteId: string, title: string, opts: { type?: string; hidden?: boolean } = {}) {
    return {
        noteId,
        title,
        type: opts.type ?? "text",
        blobId: `blob-${noteId}`,
        isDeleted: false,
        isProtected: false,
        utcDateModified: "2026-01-01 00:00:00.000Z",
        isInHiddenSubtree: () => opts.hidden ?? false,
        isContentAvailable: () => true,
        getContent: () => `content of ${title}`,
        getSubtree: () => ({ notes: [] })
    };
}

function buildTool(): ToolSet {
    const tools: ToolSet = {};
    addSemanticSearchTool(tools);
    return tools;
}

beforeEach(() => {
    getNoteMock.mockReset();
    embedQueryMock.mockReset();
    getNoteEmbeddingsMock.mockReset();
    getOllamaBaseUrlMock.mockReset();
    getOllamaBaseUrlMock.mockReturnValue("http://localhost:11434");
    for (const key of Object.keys(notesStore)) delete notesStore[key];
});

describe("addSemanticSearchTool", () => {
    it("registers nothing without a configured Ollama provider", () => {
        getOllamaBaseUrlMock.mockReturnValue(null);
        const tools = buildTool();
        expect(tools.semantic_search_notes).toBeUndefined();
    });

    it("ranks candidates by cosine similarity to the query", async () => {
        const apple = noteStub("apple", "Apples");
        const code = noteStub("code", "TypeScript");
        notesStore.apple = apple;
        notesStore.code = code;

        embedQueryMock.mockResolvedValue([1, 0]);
        getNoteEmbeddingsMock.mockResolvedValue(new Map([
            ["apple", [0, 1]],  // orthogonal → low similarity
            ["code", [1, 0]]    // aligned → high similarity
        ]));

        const tools = buildTool();
        const result = await tools.semantic_search_notes.execute!({ query: "programming" }, {} as never) as {
            results: Array<{ noteId: string; similarity: number }>;
        };

        expect(result.results.map(r => r.noteId)).toEqual(["code", "apple"]);
        expect(result.results[0].similarity).toBeGreaterThan(result.results[1].similarity);
    });

    it("skips hidden, protected and non-text candidates", async () => {
        notesStore.ok = noteStub("ok", "Visible");
        notesStore.hidden = noteStub("hidden", "Hidden", { hidden: true });
        notesStore.img = noteStub("img", "Image", { type: "image" });
        notesStore._sys = noteStub("_sys", "System");

        embedQueryMock.mockResolvedValue([1]);
        getNoteEmbeddingsMock.mockImplementation(async (notes: Array<{ noteId: string }>) =>
            new Map(notes.map(n => [n.noteId, [1]])));

        const tools = buildTool();
        await tools.semantic_search_notes.execute!({ query: "q" }, {} as never);

        const embedded = getNoteEmbeddingsMock.mock.calls[0][0] as Array<{ noteId: string }>;
        expect(embedded.map(n => n.noteId)).toEqual(["ok"]);
    });

    it("searches only the subtree when ancestorNoteId is given", async () => {
        const child = noteStub("child", "Child");
        const ancestor = { ...noteStub("root1", "Root"), getSubtree: () => ({ notes: [child] }) };
        getNoteMock.mockReturnValue(ancestor);
        notesStore.outside = noteStub("outside", "Outside");

        embedQueryMock.mockResolvedValue([1]);
        getNoteEmbeddingsMock.mockResolvedValue(new Map([["child", [1]]]));

        const tools = buildTool();
        const result = await tools.semantic_search_notes.execute!({ query: "q", ancestorNoteId: "root1" }, {} as never) as {
            results: Array<{ noteId: string }>;
        };
        expect(result.results.map(r => r.noteId)).toEqual(["child"]);
    });

    it("returns an error object for a missing ancestor note", async () => {
        getNoteMock.mockReturnValue(null);
        const tools = buildTool();
        await expect(tools.semantic_search_notes.execute!({ query: "q", ancestorNoteId: "gone" }, {} as never))
            .resolves.toEqual({ error: "Note 'gone' not found" });
    });

    it("turns embedding failures into an error result instead of throwing", async () => {
        notesStore.n = noteStub("n", "Note");
        embedQueryMock.mockRejectedValue(new Error("model missing"));
        getNoteEmbeddingsMock.mockResolvedValue(new Map());

        const tools = buildTool();
        await expect(tools.semantic_search_notes.execute!({ query: "q" }, {} as never))
            .resolves.toEqual({ error: "model missing" });
    });
});
