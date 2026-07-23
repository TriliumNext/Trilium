import { becca, cls, note_service as noteService } from "@triliumnext/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import sqlInit from "../../sql_init.js";
import graph from "./graph.js";
import { importSelection, mapWithConcurrency, resolveSubpageParents } from "./importer.js";

vi.mock("./graph.js", () => ({
    default: {
        getAccount: vi.fn(),
        listNotebooks: vi.fn(),
        listPages: vi.fn(),
        getPageContent: vi.fn(),
        getResource: vi.fn(),
        getThrottleStats: vi.fn(() => ({ requestCount: 0, waitMs: 0 })),
        resetThrottleStats: vi.fn()
    }
}));

// Delegates to the real converter, but lets a test force a content-processing failure for pages whose
// HTML carries the sentinel — the way to exercise "fetched fine, but processing threw".
vi.mock("./converter.js", async (importActual) => {
    const actual = await importActual<typeof import("./converter.js")>();
    const convertPageHtml = (html: string) => {
        if (html.includes("PROCESSING_BOOM")) {
            throw new Error("content conversion failed");
        }
        return actual.convertPageHtml(html);
    };
    return { ...actual, default: { ...actual.default, convertPageHtml } };
});

const graphMock = vi.mocked(graph);

describe("resolveSubpageParents", () => {
    it("keeps top-level pages directly under the section", () => {
        // No indentation: every page is a root (parent index -1).
        expect(resolveSubpageParents([0, 0, 0])).toEqual([-1, -1, -1]);
        expect(resolveSubpageParents([])).toEqual([]);
    });

    it("nests subpages and sub-subpages under the nearest shallower page", () => {
        // Two subpages share the first page as parent.
        expect(resolveSubpageParents([0, 1, 1])).toEqual([-1, 0, 0]);
        // A sub-subpage chains under its subpage.
        expect(resolveSubpageParents([0, 1, 2])).toEqual([-1, 0, 1]);
    });

    it("re-parents siblings correctly when stepping back out of nesting", () => {
        // 0:root, 1→0, 2→1, then back to level 1 (→0) and a new root.
        expect(resolveSubpageParents([0, 1, 2, 1, 0])).toEqual([-1, 0, 1, 0, -1]);
        // Each top-level page owns its own subpage.
        expect(resolveSubpageParents([0, 1, 0, 1])).toEqual([-1, 0, -1, 2]);
    });

    it("falls back to the section root for malformed indentation", () => {
        // Leading subpage with no parent, and a level jump that skips level 1.
        expect(resolveSubpageParents([1, 0])).toEqual([-1, -1]);
        expect(resolveSubpageParents([0, 2])).toEqual([-1, -1]);
    });
});

describe("mapWithConcurrency", () => {
    it("returns results in input order regardless of completion order", async () => {
        // Later items resolve sooner, so order can only be preserved by index, not completion.
        const out = await mapWithConcurrency([30, 20, 10], 3, (ms) => new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)));
        expect(out).toEqual([30, 20, 10]);
    });

    it("never runs more than `limit` workers at once", async () => {
        let inFlight = 0;
        let peak = 0;
        const work = async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
            return null;
        };

        await mapWithConcurrency(Array.from({ length: 20 }), 4, work);
        expect(peak).toBeLessThanOrEqual(4);
    });

    it("handles an empty list", async () => {
        expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    });
});

describe("importSelection (real DB)", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    it("labels every imported page note with its Graph page id", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-abc", title: "Page One", level: 0 },
            { id: "1-def", title: "Page Two", level: 1 }
        ]);
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hello</p>", inkml: "" });

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: "root",
            sections: [{ id: "sec-1", title: "Section", groupPath: [], notebookId: "nb-1", notebookTitle: "Notebook" }],
            taskId: "task-page-id-label"
        }));

        const pageOne = Object.values(becca.notes).find((note) => note.title === "Page One");
        const pageTwo = Object.values(becca.notes).find((note) => note.title === "Page Two");
        // The Graph page id enables a future "retry failed pages" / re-import dedup pass to map an
        // imported note back to its OneNote page.
        expect(pageOne?.getOwnedLabelValue("oneNotePageId")).toBe("1-abc");
        expect(pageTwo?.getOwnedLabelValue("oneNotePageId")).toBe("1-def");

        // Container notes (section, notebook) are not OneNote pages and must not carry the label.
        const sectionNote = Object.values(becca.notes).find((note) => note.title === "Section");
        expect(sectionNote?.getOwnedLabelValue("oneNotePageId")).toBeNull();
    });

    it("writes an import report as the root import note's content", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-abc", title: "Report Page One", level: 0 },
            { id: "1-def", title: "Report Page Two", level: 0 }
        ]);
        graphMock.getPageContent.mockResolvedValue({ html: "<p>hello</p>", inkml: "" });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "report parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-2", title: "Report Section", groupPath: [], notebookId: "nb-2", notebookTitle: "Report Notebook" }],
            taskId: "task-report"
        }));

        const rootImportNote = parent.getChildNotes()[0];
        const content = rootImportNote?.getContent() as string;
        expect(content).toContain('<tr><th scope="row">Pages imported successfully</th><td>2/2 (100%)</td></tr>');
        expect(content).toContain('<tr><th scope="row">Sections imported</th><td>1</td></tr>');
        // Nothing failed and no optional stats apply (no images, ink, links, or throttling), so the
        // happy-path report stays a compact summary table without failure sections or extra rows.
        expect(content).not.toContain("could not be");
        expect(content).not.toContain("Images");
    });

    it("imports a placeholder note when a page's content cannot be fetched, keeping the tree intact", async () => {
        graphMock.listPages.mockResolvedValue([
            { id: "1-good", title: "Ph Good", level: 0 },
            { id: "1-bad", title: "Ph Bad", level: 0 },
            { id: "1-sub", title: "Ph Sub", level: 1 }
        ]);
        graphMock.getPageContent.mockImplementation(async (_token, pageId) => {
            if (pageId === "1-bad") {
                throw new Error("Failed to fetch OneNote page content (HTTP 504)");
            }
            return { html: "<p>ok</p>", inkml: "" };
        });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "placeholder parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-3", title: "Ph Section", groupPath: [], notebookId: "nb-3", notebookTitle: "Ph Notebook" }],
            taskId: "task-placeholder"
        }));

        // The failed page becomes a placeholder note: findable by label, explains itself, and keeps
        // the page id so a later retry pass can re-fetch it.
        const badNote = Object.values(becca.notes).find((note) => note.title === "Ph Bad");
        expect(badNote?.hasOwnedLabel("oneNoteImportFailed")).toBe(true);
        expect(badNote?.getOwnedLabelValue("oneNotePageId")).toBe("1-bad");
        expect(badNote?.getContent()).toContain("could not be imported");
        expect(badNote?.getContent()).toContain("HTTP 504");

        // Subpage nesting resolves by index, so the placeholder must hold its parent spot in the tree.
        const subNote = Object.values(becca.notes).find((note) => note.title === "Ph Sub");
        expect(subNote?.getParentNotes()[0]?.noteId).toBe(badNote?.noteId);

        // The report counts the loss and links to the placeholder.
        const content = parent.getChildNotes()[0]?.getContent() as string;
        expect(content).toContain('<tr><th scope="row">Pages imported successfully</th><td>2/3 (66%)</td></tr>');
        expect(content).toContain("Pages that could not be imported");
        expect(content).toContain(`href="#root/${badNote?.noteId}"`);
    });

    it("aborts the import when too many consecutive pages fail (systemic failure)", async () => {
        graphMock.listPages.mockResolvedValue(
            Array.from({ length: 8 }, (_, i) => ({ id: `1-cb${i}`, title: `CB Page ${i}`, level: 0 }))
        );
        graphMock.getPageContent.mockClear();
        graphMock.getPageContent.mockImplementation(async () => {
            throw new Error("Failed to fetch OneNote page content (HTTP 504)");
        });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "circuit breaker parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-4", title: "CB Section", groupPath: [], notebookId: "nb-4", notebookTitle: "CB Notebook" }],
            taskId: "task-circuit-breaker"
        }));

        // Six consecutive failures trip the breaker: the remaining pages are never fetched and the
        // import aborts without creating any notes (a placeholder-only tree would be worthless).
        expect(graphMock.getPageContent).toHaveBeenCalledTimes(6);
        expect(parent.getChildNotes()).toHaveLength(0);
    });

    it("does not trip the breaker when pages fetch but fail local processing", async () => {
        // All eight pages fetch successfully (Graph is healthy) but every one fails to convert. These
        // are isolated bad pages, not a systemic outage, so the import must finish with placeholders
        // rather than aborting the way a run of fetch failures does.
        graphMock.listPages.mockResolvedValue(
            Array.from({ length: 8 }, (_, i) => ({ id: `1-pf${i}`, title: `PF Page ${i}`, level: 0 }))
        );
        graphMock.getPageContent.mockClear();
        graphMock.getPageContent.mockResolvedValue({ html: "<p>PROCESSING_BOOM</p>", inkml: "" });

        const parent = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "processing failure parent",
            content: "",
            type: "text",
            mime: "text/html"
        }).note);

        await cls.init(() => importSelection({
            getAccessToken: () => Promise.resolve("token"),
            parentNoteId: parent.noteId,
            sections: [{ id: "sec-5", title: "PF Section", groupPath: [], notebookId: "nb-5", notebookTitle: "PF Notebook" }],
            taskId: "task-processing-failure"
        }));

        // Every page was fetched (no early abort) and imported as a placeholder.
        expect(graphMock.getPageContent).toHaveBeenCalledTimes(8);
        const pages = new Map(Object.values(becca.notes).filter((note) => /^PF Page \d+$/.test(note.title)).map((note) => [note.noteId, note]));
        expect(pages.size).toBe(8);
        expect([...pages.values()].every((note) => note.hasOwnedLabel("oneNoteImportFailed"))).toBe(true);
        expect([...pages.values()][0]?.getContent()).toContain("could not be imported");
    });
});
