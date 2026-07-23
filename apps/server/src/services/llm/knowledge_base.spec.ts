import { beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteMock } = vi.hoisted(() => ({
    getNoteMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, getNote: getNoteMock }
    };
});

import { buildKnowledgeBaseSources, resolveKnowledgeBaseSources } from "./knowledge_base.js";

/** A minimal note stub exposing what the KB builder reads. */
function noteStub({
    noteId,
    title,
    type = "text",
    content = "",
    children = [] as ReturnType<typeof noteStub>[],
    contentAvailable = true
}: {
    noteId: string;
    title: string;
    type?: string;
    content?: string;
    children?: unknown[];
    contentAvailable?: boolean;
}) {
    return {
        noteId,
        type,
        getTitleOrProtected: () => title,
        getChildNotes: () => children,
        isContentAvailable: () => contentAvailable,
        getContent: () => content
    };
}

beforeEach(() => {
    getNoteMock.mockReset();
});

describe("resolveKnowledgeBaseSources", () => {
    it("resolves titles in order and keeps missing notes as placeholders", () => {
        getNoteMock.mockImplementation((id: string) =>
            id === "a" ? noteStub({ noteId: "a", title: "Note A" }) : null
        );

        expect(resolveKnowledgeBaseSources(["a", "missing"])).toEqual([
            { noteId: "a", title: "Note A" },
            { noteId: "missing", title: "missing" }
        ]);
    });

    it("caps the list at the KB source limit", () => {
        getNoteMock.mockImplementation((id: string) => noteStub({ noteId: id, title: id }));
        const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
        expect(resolveKnowledgeBaseSources(ids)).toHaveLength(20);
    });
});

describe("buildKnowledgeBaseSources", () => {
    it("returns null when no source note resolves", () => {
        getNoteMock.mockReturnValue(null);
        expect(buildKnowledgeBaseSources(["gone"])).toBeNull();
    });

    it("includes titles, previews and a numbered reference list", () => {
        getNoteMock.mockImplementation((id: string) =>
            id === "a"
                ? noteStub({ noteId: "a", title: "Note A", content: "<p>Hello <b>world</b></p>" })
                : noteStub({ noteId: "b", title: "Note B", type: "code", content: "console.log(1);" })
        );

        const prompt = buildKnowledgeBaseSources(["a", "b"])!;

        // Reference list numbering follows the source order.
        expect(prompt).toContain("[1] Note A [[a]]");
        expect(prompt).toContain("[2] Note B [[b]]");
        // Text note content is HTML-stripped; code notes keep their content and show their type.
        expect(prompt).toContain("Hello world");
        expect(prompt).toContain("console.log(1);");
        expect(prompt).toContain("Type: code");
        // The model is told not to write its own reference section — the UI shows sources.
        expect(prompt).toContain("Do NOT append a reference or bibliography section");
    });

    it("truncates long content previews", () => {
        getNoteMock.mockReturnValue(noteStub({ noteId: "a", title: "Long", content: "x".repeat(5000) }));
        const prompt = buildKnowledgeBaseSources(["a"])!;
        expect(prompt).toContain(`${"x".repeat(1500)}…`);
        expect(prompt).not.toContain("x".repeat(1501));
    });

    it("lists child notes so the model can navigate the subtree", () => {
        const child = noteStub({ noteId: "c1", title: "Child One" });
        getNoteMock.mockReturnValue(noteStub({ noteId: "p", title: "Parent", children: [child] }));
        const prompt = buildKnowledgeBaseSources(["p"])!;
        expect(prompt).toContain("Child notes: Child One (c1)");
    });
});
