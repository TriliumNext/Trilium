import type { BNote } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Fake on-disk help pages: path suffix → HTML content. */
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

import { getDocNoteHtml } from "./doc_notes.js";

/** Minimal BNote stub exposing only the label lookup the reader performs. */
function docNoteStub(docName: string | null) {
    return {
        noteId: "n1",
        type: "doc",
        getLabelValue: (name: string) => (name === "docName" ? docName : null)
    } as unknown as BNote;
}

describe("getDocNoteHtml", () => {
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
});
