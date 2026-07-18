import type { BAttachment, BNote } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlobMock = vi.hoisted(() => vi.fn());

// getContentPreview / getNoteContentForLlm consult becca.getBlob (SQL-backed);
// partial-mock core so it returns deterministic blobs while markdown
// import/export services keep their real implementations.
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, getBlob: getBlobMock }
    };
});

/** Fake on-disk help pages for getDocNoteHtml: path suffix → HTML content. */
const docFiles = vi.hoisted(() => new Map<string, string>());

// Doc notes read their HTML from disk — serve them from the docFiles fixture
// map and pass every other path through to the real fs.
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    const readFileSync = ((filePath: unknown, ...rest: unknown[]) => {
        const pathStr = String(filePath);
        for (const [suffix, content] of docFiles) {
            if (pathStr.endsWith(suffix)) return content;
        }
        if (pathStr.includes("doc_notes")) {
            throw new Error(`ENOENT: ${pathStr}`);
        }
        return (actual.readFileSync as (...args: unknown[]) => unknown)(filePath, ...rest);
    }) as typeof actual.readFileSync;
    const mocked = { ...actual, readFileSync };
    return { ...mocked, default: mocked };
});

import {
    applyTextEdits,
    flag,
    getAttachmentContentPreview,
    getContentPreview,
    getDocNoteHtml,
    getNoteContentForLlm,
    getNoteMeta,
    setNoteContentFromLlm
} from "./helpers.js";

/** Minimal BNote stub exposing only what the helpers under test call. */
function noteStub(overrides: Partial<Record<string, unknown>> = {}): BNote {
    return {
        noteId: "n1",
        title: "Note 1",
        type: "text",
        mime: "text/html",
        isProtected: false,
        blobId: "b1",
        dateCreated: "2026-01-01",
        dateModified: "2026-01-02",
        isContentAvailable: () => true,
        getContent: () => "<p>hello</p>",
        getTitleOrProtected: () => "Note 1",
        getChildNotes: () => [],
        getParentNotes: () => [],
        getAttributes: () => [],
        getAttachments: () => [],
        getLabelValue: () => null,
        setContent: vi.fn(),
        ...overrides
    } as unknown as BNote;
}

/** A doc-note stub (in-app help page) with the given #docName label. */
function docNoteStub(docName: string | null) {
    return noteStub({
        type: "doc",
        blobId: "",
        getContent: () => "",
        getLabelValue: (name: string) => (name === "docName" ? docName : null)
    });
}

function attachmentStub(overrides: Partial<Record<string, unknown>> = {}): BAttachment {
    return {
        attachmentId: "a1",
        role: "file",
        mime: "text/plain",
        title: "doc.txt",
        contentLength: 10,
        blobId: "b1",
        hasStringContent: () => true,
        getContent: () => "attachment text",
        ...overrides
    } as unknown as BAttachment;
}

describe("flag", () => {
    it("returns true for truthy and undefined otherwise", () => {
        expect(flag(true)).toBe(true);
        expect(flag(false)).toBeUndefined();
        expect(flag(undefined)).toBeUndefined();
    });
});

describe("getNoteContentForLlm", () => {
    beforeEach(() => getBlobMock.mockReset());

    it("converts text notes from HTML to Markdown", () => {
        const note = noteStub({ type: "text", getContent: () => "<h1>Title</h1>" });
        expect(getNoteContentForLlm(note)).toContain("# Title");
    });

    it("returns code-note content verbatim", () => {
        const note = noteStub({ type: "code", mime: "text/plain", getContent: () => "const x = 1;" });
        expect(getNoteContentForLlm(note)).toBe("const x = 1;");
    });

    it("uses the blob's extracted text for binary content", () => {
        const note = noteStub({ type: "image", getContent: () => new Uint8Array([1, 2, 3]) });
        getBlobMock.mockReturnValue({ textRepresentation: "scanned words" });
        expect(getNoteContentForLlm(note)).toBe("[extracted text from image]\nscanned words");
    });

    it("falls back to a binary-content marker when no extracted text exists", () => {
        const noBlob = noteStub({ type: "image", blobId: "", getContent: () => new Uint8Array([1]) });
        expect(getNoteContentForLlm(noBlob)).toBe("[binary content]");

        const emptyBlob = noteStub({ type: "image", getContent: () => new Uint8Array([1]) });
        getBlobMock.mockReturnValue({ textRepresentation: null });
        expect(getNoteContentForLlm(emptyBlob)).toBe("[binary content]");
    });
});

describe("getDocNoteHtml / doc notes", () => {
    beforeEach(() => docFiles.clear());

    it("reads the page HTML from disk under doc_notes/en", () => {
        docFiles.set("Cloning Notes.html", "<h2>Cloning</h2>");
        expect(getDocNoteHtml(docNoteStub("User Guide/User Guide/Cloning Notes"))).toBe("<h2>Cloning</h2>");
    });

    it("returns null without a docName label, on a missing file, and on path traversal attempts", () => {
        expect(getDocNoteHtml(docNoteStub(null))).toBeNull();
        expect(getDocNoteHtml(docNoteStub("User Guide/Nonexistent Page"))).toBeNull();
        // Traversal attempts must be rejected before touching the filesystem —
        // register a catch-all fixture so any read would be visible.
        docFiles.set(".html", "<p>leaked</p>");
        expect(getDocNoteHtml(docNoteStub("../../../../etc/passwd"))).toBeNull();
        expect(getDocNoteHtml(docNoteStub("/etc/passwd"))).toBeNull();
    });

    it("getNoteContentForLlm converts doc-note HTML to Markdown", () => {
        docFiles.set("Cloning Notes.html", "<h2>Cloning</h2><p>Place a note in two locations.</p>");
        const content = getNoteContentForLlm(docNoteStub("User Guide/User Guide/Cloning Notes"));
        expect(content).toContain("## Cloning");
        expect(content).toContain("Place a note in two locations.");
    });

    it("getNoteContentForLlm and getContentPreview degrade gracefully for unresolvable doc notes", () => {
        getBlobMock.mockReturnValue(null);
        const note = docNoteStub(null);
        expect(getNoteContentForLlm(note)).toBe("[doc content not available]");
        expect(getContentPreview(note)).toBeNull();
    });
});

describe("setNoteContentFromLlm", () => {
    it("renders Markdown to HTML for text notes", () => {
        const note = noteStub({ type: "text" });
        setNoteContentFromLlm(note, "# Heading");
        const [written] = (note.setContent as ReturnType<typeof vi.fn>).mock.calls[0];
        // Trilium's markdown importer renders the document title as h1, so a
        // top-level "# Heading" becomes an <h2> in the body.
        expect(written).toContain("Heading");
        expect(written).toMatch(/<h[12]>/);
    });

    it("stores raw content for non-text notes", () => {
        const note = noteStub({ type: "code", mime: "text/plain" });
        setNoteContentFromLlm(note, "raw code");
        expect(note.setContent).toHaveBeenCalledWith("raw code");
    });
});

describe("getContentPreview", () => {
    beforeEach(() => getBlobMock.mockReset());

    it("returns null when content is not available (protected)", () => {
        expect(getContentPreview(noteStub({ isContentAvailable: () => false }))).toBeNull();
    });

    it("returns a size hint for large notes without loading content", () => {
        getBlobMock.mockReturnValue({ contentLength: 50_000 });
        const result = getContentPreview(noteStub());
        expect(result).toMatch(/\d+KB - use get_note_content/);
    });

    it("returns null for binary/empty content", () => {
        getBlobMock.mockReturnValue({ contentLength: 5 });
        const binary = noteStub({ type: "image", getContent: () => new Uint8Array([1]), blobId: "" });
        expect(getContentPreview(binary)).toBeNull();
    });

    it("returns the full converted content when short", () => {
        getBlobMock.mockReturnValue({ contentLength: 5 });
        const note = noteStub({ type: "code", mime: "text/plain", getContent: () => "short" });
        expect(getContentPreview(note)).toBe("short");
    });

    it("truncates long content with an ellipsis", () => {
        getBlobMock.mockReturnValue({ contentLength: 600 });
        const long = "x".repeat(600);
        const note = noteStub({ type: "code", mime: "text/plain", getContent: () => long });
        const result = getContentPreview(note)!;
        expect(result.endsWith("…")).toBe(true);
        expect(result.length).toBe(501); // 500 chars + ellipsis
    });

    it("loads content normally when there is no blob to size-check", () => {
        getBlobMock.mockReturnValue(null);
        const note = noteStub({ type: "code", mime: "text/plain", getContent: () => "abc" });
        expect(getContentPreview(note)).toBe("abc");
    });
});

describe("getAttachmentContentPreview", () => {
    beforeEach(() => getBlobMock.mockReset());

    it("returns the raw text of a string attachment", () => {
        expect(getAttachmentContentPreview(attachmentStub({ getContent: () => "hi" }))).toBe("hi");
    });

    it("uses the blob's extracted text for binary attachments", () => {
        getBlobMock.mockReturnValue({ textRepresentation: "ocr text" });
        const att = attachmentStub({ hasStringContent: () => false, mime: "image/png" });
        expect(getAttachmentContentPreview(att)).toBe("ocr text");
    });

    it("returns null when no readable text exists", () => {
        // Binary without blob.
        const noBlob = attachmentStub({ hasStringContent: () => false, blobId: "" });
        expect(getAttachmentContentPreview(noBlob)).toBeNull();
        // Binary with blob but no extracted text.
        getBlobMock.mockReturnValue({ textRepresentation: null });
        const emptyBlob = attachmentStub({ hasStringContent: () => false });
        expect(getAttachmentContentPreview(emptyBlob)).toBeNull();
    });

    it("truncates long attachment text", () => {
        const att = attachmentStub({ getContent: () => "y".repeat(300) });
        const result = getAttachmentContentPreview(att)!;
        expect(result.endsWith("…")).toBe(true);
        expect(result.length).toBe(201); // 200 chars + ellipsis
    });
});

describe("getNoteMeta", () => {
    beforeEach(() => getBlobMock.mockReset());

    it("builds metadata with truncated children/attributes/attachments and total counts", () => {
        getBlobMock.mockReturnValue({ contentLength: 5 });
        const children = Array.from({ length: 3 }, (_, i) => ({
            noteId: `c${i}`,
            getTitleOrProtected: () => `Child ${i}`
        }));
        const attrs = [
            { attributeId: "at1", type: "label", name: "color", value: "red", isInheritable: true },
            { attributeId: "at2", type: "relation", name: "ref", value: "n2", isInheritable: false }
        ];
        const attachments = [attachmentStub({ getContent: () => "preview" })];

        const note = noteStub({
            type: "code",
            mime: "text/plain",
            isProtected: true,
            getContent: () => "body",
            getChildNotes: () => children,
            getParentNotes: () => [{ noteId: "root" }],
            getAttributes: () => attrs,
            getAttachments: () => attachments
        });

        const meta = getNoteMeta(note, { childNotes: 2, attributes: 5, attachments: 5 }) as any;

        expect(meta.noteId).toBe("n1");
        expect(meta.isProtected).toBe(true);
        expect(meta.parentNoteIds).toEqual(["root"]);
        expect(meta.childNotes).toEqual({
            totalCount: 3,
            results: [
                { noteId: "c0", title: "Child 0" },
                { noteId: "c1", title: "Child 1" }
            ]
        });
        expect(meta.attributes.totalCount).toBe(2);
        expect(meta.attributes.results[0]).toEqual({
            attributeId: "at1", type: "label", name: "color", value: "red", isInheritable: true
        });
        // isInheritable:false is omitted via flag().
        expect(meta.attributes.results[1].isInheritable).toBeUndefined();
        expect(meta.attachments.totalCount).toBe(1);
        expect(meta.attachments.results[0].contentPreview).toBe("preview");
        expect(meta.contentPreview).toBe("body");
    });
});

// Existing applyTextEdits coverage (kept; exercises the find-and-replace path).
describe("applyTextEdits", () => {
    it("applies a single find-and-replace edit", () => {
        const result = applyTextEdits("const x = 1;\nconst y = 2;\n", [
            { oldText: "const x = 1;", newText: "const x = 42;" }
        ]);
        expect(result).toEqual({ ok: true, content: "const x = 42;\nconst y = 2;\n" });
    });

    it("applies multiple edits in order, including one that targets earlier output", () => {
        const result = applyTextEdits("a\nb\nc\n", [
            { oldText: "a", newText: "X" },
            { oldText: "b", newText: "Y" },
            // Edit 3 matches text introduced by edit 1 — edits see prior results.
            { oldText: "X", newText: "Z" }
        ]);
        expect(result).toEqual({ ok: true, content: "Z\nY\nc\n" });
    });

    it("rejects an edit whose oldText is absent", () => {
        const result = applyTextEdits("hello world", [{ oldText: "goodbye", newText: "hi" }]);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    });

    it("rejects an ambiguous oldText that matches more than once", () => {
        const result = applyTextEdits("foo foo", [{ oldText: "foo", newText: "bar" }]);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not unique") });
    });

    it("rejects empty and no-op edits", () => {
        expect(applyTextEdits("abc", [{ oldText: "", newText: "x" }]))
            .toMatchObject({ ok: false, error: expect.stringContaining("empty") });
        expect(applyTextEdits("abc", [{ oldText: "abc", newText: "abc" }]))
            .toMatchObject({ ok: false, error: expect.stringContaining("identical") });
    });

    it("is all-or-nothing: a later failing edit discards earlier ones and names the offender", () => {
        const result = applyTextEdits("keep this", [
            { oldText: "keep", newText: "KEEP" },
            { oldText: "missing", newText: "x" }
        ]);
        // The error pinpoints the failing edit, and no content is returned to commit —
        // so a partially-applied batch can never reach the note.
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("edit 2 of 2") });
        expect(result).not.toHaveProperty("content");
    });
});
