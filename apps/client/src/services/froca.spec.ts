import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import FNote from "../entities/fnote.js";
import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import server from "./server.js";

// `logError` / `logInfo` are window globals referenced by froca; ensure they exist.
(globalThis as any).logError = (globalThis as any).logError ?? (() => {});
(globalThis as any).logInfo = (globalThis as any).logInfo ?? (() => {});

const realServerGet = server.get;
const realServerPost = server.post;
const realServerGetSilent = server.getWithSilentNotFound;
const realTriggerEvent = appContext.triggerEvent;

beforeEach(() => {
    vi.restoreAllMocks();
    // Keep appContext side-effects out of these unit tests.
    appContext.triggerEvent = vi.fn(async () => []) as typeof appContext.triggerEvent;
});

afterEach(() => {
    server.get = realServerGet;
    server.post = realServerPost;
    server.getWithSilentNotFound = realServerGetSilent;
    appContext.triggerEvent = realTriggerEvent;
});

describe("loadInitialTree", () => {
    it("returns early when the database is not initialized", async () => {
        (globalThis as any).glob.dbInitialized = false;
        server.get = vi.fn(async () => {
            throw new Error("should not be called");
        }) as typeof server.get;

        await expect(froca.loadInitialTree()).resolves.toBeUndefined();
        expect(server.get).not.toHaveBeenCalled();
    });

    it("clears and re-populates the cache from the tree endpoint when initialized", async () => {
        (globalThis as any).glob.dbInitialized = true;
        const noteId = "init-tree-note";
        server.get = vi.fn(async () => ({
            notes: [{ noteId, title: "Root", type: "text", mime: "text/html", isProtected: false, blobId: "" }],
            branches: [],
            attributes: []
        })) as typeof server.get;

        await froca.loadInitialTree();

        expect(server.get).toHaveBeenCalledWith("tree");
        expect(froca.notes[noteId]).toBeInstanceOf(FNote);
        (globalThis as any).glob.dbInitialized = false;
    });
});

describe("loadSubTree", () => {
    it("fetches the subtree and returns the requested note", async () => {
        const noteId = "subtree-target";
        server.get = vi.fn(async () => ({
            notes: [{ noteId, title: "Sub", type: "text", mime: "text/html", isProtected: false, blobId: "" }],
            branches: [],
            attributes: []
        })) as typeof server.get;

        const note = await froca.loadSubTree(noteId);

        expect(server.get).toHaveBeenCalledWith(`tree?subTreeNoteId=${noteId}`);
        expect(note).toBe(froca.notes[noteId]);
    });
});

describe("addResp", () => {
    function row(noteId: string, type = "text") {
        return { noteId, title: noteId, type, mime: "text/html", isProtected: false, blobId: "" } as any;
    }

    it("creates new notes and wires branches + attributes + relation target", () => {
        const parentId = "ar-parent";
        const childId = "ar-child";
        const targetId = "ar-target";

        froca.addResp({
            notes: [row(parentId), row(childId), row(targetId)],
            branches: [
                {
                    branchId: `${parentId}-${childId}`,
                    noteId: childId,
                    parentNoteId: parentId,
                    notePosition: 10,
                    fromSearchNote: false
                } as any
            ],
            attributes: [
                { attributeId: "ar-attr", noteId: childId, type: "label", name: "color", value: "red", position: 0, isInheritable: false } as any,
                { attributeId: "ar-rel", noteId: childId, type: "relation", name: "link", value: targetId, position: 1, isInheritable: false } as any
            ]
        });

        const parent = froca.notes[parentId];
        const child = froca.notes[childId];
        const target = froca.notes[targetId];

        expect(parent.children).toContain(childId);
        expect(child.parents).toContain(parentId);
        expect(child.attributes).toContain("ar-attr");
        expect(child.attributes).toContain("ar-rel");
        expect(target.targetRelations).toContain("ar-rel");
    });

    it("is idempotent for attributes and relation targets already tracked", () => {
        const noteId = "ar-idem";
        const targetId = "ar-idem-target";
        froca.addResp({ notes: [row(noteId), row(targetId)], branches: [], attributes: [] });

        const attrRows = [
            { attributeId: "ar-idem-attr", noteId, type: "label", name: "c", value: "v", position: 0, isInheritable: false } as any,
            { attributeId: "ar-idem-rel", noteId, type: "relation", name: "r", value: targetId, position: 1, isInheritable: false } as any
        ];

        froca.addResp({ notes: [], branches: [], attributes: attrRows });
        froca.addResp({ notes: [], branches: [], attributes: attrRows });

        const note = froca.notes[noteId];
        const target = froca.notes[targetId];
        expect(note.attributes.filter((a) => a === "ar-idem-attr")).toHaveLength(1);
        expect(target.targetRelations.filter((a) => a === "ar-idem-rel")).toHaveLength(1);
    });

    it("ignores branches/attributes whose related notes are not loaded", () => {
        froca.addResp({
            notes: [],
            branches: [
                { branchId: "orphan-branch", noteId: "ghost-child", parentNoteId: "ghost-parent", notePosition: 0, fromSearchNote: false } as any
            ],
            attributes: [
                { attributeId: "orphan-attr", noteId: "ghost-note", type: "relation", name: "r", value: "ghost-target", position: 0, isInheritable: false } as any
            ]
        });

        expect(froca.branches["orphan-branch"]).toBeDefined();
        // No note was wired up since neither parent nor child are loaded.
        expect(froca.notes["ghost-child"]).toBeUndefined();
    });

    it("rebuilds children and real parents for an existing non-search note, preserving virtual parents", () => {
        // Build the real parent -> existing -> child structure as one tree so references stay stable.
        const realParent = buildNote({
            id: "ar-existing-realparent",
            title: "RealParent",
            children: [
                {
                    id: "ar-existing",
                    title: "Existing",
                    children: [{ id: "ar-existing-child", title: "Child" }]
                }
            ]
        });
        const note = froca.notes["ar-existing"];
        expect(note.children).toContain("ar-existing-child");
        expect(note.parents).toContain(realParent.noteId);

        // Add a virtual (search) parent branch manually.
        const searchParent = buildNote({ id: "ar-existing-searchparent", title: "SearchParent" });
        const virtBranchId = "virt-ar-existing-searchparent-ar-existing";
        froca.addResp({
            notes: [],
            branches: [
                {
                    branchId: virtBranchId,
                    noteId: "ar-existing",
                    parentNoteId: searchParent.noteId,
                    notePosition: 10,
                    fromSearchNote: true
                } as any
            ],
            attributes: []
        });
        expect(note.parents).toContain(searchParent.noteId);

        // Re-send the existing note: children should be wiped, real parent removed, virtual parent kept.
        froca.addResp({
            notes: [{ noteId: "ar-existing", title: "Existing v2", type: "text", mime: "text/html", isProtected: false, blobId: "" } as any],
            branches: [],
            attributes: []
        });

        expect(note.title).toBe("Existing v2");
        expect(note.children).toEqual([]);
        expect(note.parents).not.toContain(realParent.noteId);
        expect(note.parents).toContain(searchParent.noteId);
    });

    it("skips child cleanup for a child id with no loaded note object", () => {
        const note = buildNote({ id: "ar-dangling", title: "Dangling" });
        // Inject a child id that has no backing note in the cache.
        note.children = ["ar-dangling-ghost"];
        note.childToBranch = { "ar-dangling-ghost": "ar-dangling-ghost-branch" };

        froca.addResp({
            notes: [{ noteId: "ar-dangling", title: "Dangling v2", type: "text", mime: "text/html", isProtected: false, blobId: "" } as any],
            branches: [],
            attributes: []
        });

        expect(note.children).toEqual([]);
        expect(froca.notes["ar-dangling-ghost"]).toBeUndefined();
    });

    it("does not wipe children for an existing search note", () => {
        const searchNote = buildNote({
            id: "ar-search",
            title: "Saved search",
            type: "search",
            children: [{ id: "ar-search-result", title: "Result" }]
        });
        expect(searchNote.children).toContain("ar-search-result");

        froca.addResp({
            notes: [{ noteId: "ar-search", title: "Saved search v2", type: "search", mime: "text/html", isProtected: false, blobId: "" } as any],
            branches: [],
            attributes: []
        });

        expect(searchNote.children).toContain("ar-search-result");
    });

    it("drops a real parent whose branch entry is missing", () => {
        const note = buildNote({
            id: "ar-missing-branch",
            title: "Note",
            children: [{ id: "ar-missing-branch-child", title: "Child" }]
        });
        const child = froca.notes["ar-missing-branch-child"];
        // Remove the branch object but keep the childToBranch mapping so `!branch` is hit.
        const branchId = note.childToBranch["ar-missing-branch-child"];
        delete froca.branches[branchId];

        froca.addResp({
            notes: [{ noteId: "ar-missing-branch-child", title: "Child v2", type: "text", mime: "text/html", isProtected: false, blobId: "" } as any],
            branches: [],
            attributes: []
        });

        expect(child.parents).not.toContain("ar-missing-branch");
    });
});

describe("reloadNotes", () => {
    it("returns early for an empty list without hitting the server", async () => {
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        await froca.reloadNotes([]);
        expect(server.post).not.toHaveBeenCalled();
    });

    it("dedupes ids, posts to tree/load, and triggers notesReloaded", async () => {
        server.post = vi.fn(async () => ({
            notes: [{ noteId: "reload-1", title: "R", type: "text", mime: "text/html", isProtected: false, blobId: "" }],
            branches: [],
            attributes: []
        })) as typeof server.post;

        await froca.reloadNotes(["reload-1", "reload-1"]);

        expect(server.post).toHaveBeenCalledWith("tree/load", { noteIds: ["reload-1"] });
        expect(appContext.triggerEvent).toHaveBeenCalledWith("notesReloaded", { noteIds: ["reload-1"] });
    });
});

describe("loadSearchNote", () => {
    it("returns undefined for a missing note or a non-search note", async () => {
        await expect(froca.loadSearchNote("none")).resolves.toBeUndefined();

        const text = buildNote({ id: "ls-text", title: "Text", type: "text" });
        await expect(froca.loadSearchNote(text.noteId)).resolves.toBeUndefined();
    });

    it("throws when the server returns a non-array search result", async () => {
        const search = buildNote({ id: "ls-bad", title: "Search", type: "search" });
        server.get = vi.fn(async () => ({ searchResultNoteIds: "boom", highlightedTokens: [], error: null })) as typeof server.get;
        await expect(froca.loadSearchNote(search.noteId)).rejects.toThrow(/failed/);
        expect(server.get).toHaveBeenCalledWith(`search-note/${search.noteId}`);
    });

    it("populates virtual child branches from search results", async () => {
        const search = buildNote({ id: "ls-ok", title: "Search", type: "search" });
        const result = buildNote({ id: "ls-result", title: "Result", type: "text" });
        // Pre-seed a stale virtual child to verify it gets reset.
        search.children = ["stale"];
        search.childToBranch = { stale: "virt-stale" };

        server.get = vi.fn(async () => ({
            searchResultNoteIds: [result.noteId],
            highlightedTokens: ["token"],
            error: null
        })) as typeof server.get;

        const out = await froca.loadSearchNote(search.noteId);

        expect(server.get).toHaveBeenCalledWith(`search-note/${search.noteId}`);
        expect(out).toEqual({ error: null });
        expect(search.searchResultsLoaded).toBe(true);
        expect(search.highlightedTokens).toEqual(["token"]);
        expect(search.children).toContain(result.noteId);
        expect(search.children).not.toContain("stale");
    });

    it("tolerates the note disappearing from the cache mid-load", async () => {
        const search = buildNote({ id: "ls-gone", title: "Search", type: "search" });
        const result = buildNote({ id: "ls-gone-result", title: "Result", type: "text" });

        server.get = vi.fn(async () => {
            // Simulate the note being evicted from froca during the request.
            delete froca.notes["ls-gone"];
            return { searchResultNoteIds: [result.noteId], highlightedTokens: [], error: "oops" };
        }) as typeof server.get;

        const out = await froca.loadSearchNote(search.noteId);
        expect(server.get).toHaveBeenCalledWith(`search-note/${search.noteId}`);
        expect(out).toEqual({ error: "oops" });
        expect(froca.notes["ls-gone"].searchResultsLoaded).toBe(true);
    });
});

describe("getNotesFromCache", () => {
    it("returns cached notes, traces and drops unknown ids, and stays silent when asked", () => {
        const note = buildNote({ id: "gfc-note", title: "N" });
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});

        const found = froca.getNotesFromCache([note.noteId, "gfc-missing"]);
        expect(found).toEqual([note]);
        expect(trace).toHaveBeenCalled();

        trace.mockClear();
        const silent = froca.getNotesFromCache(["gfc-missing-2"], true);
        expect(silent).toEqual([]);
        expect(trace).not.toHaveBeenCalled();
    });
});

describe("getNotes / getNote / noteExists / getNoteFromCache", () => {
    it("getNotes returns [] for empty input", async () => {
        await expect(froca.getNotes([])).resolves.toEqual([]);
    });

    it("getNotes reloads missing ids, dedupes, and filters unknowns", async () => {
        const known = buildNote({ id: "gn-known", title: "Known" });
        server.post = vi.fn(async () => ({
            notes: [{ noteId: "gn-loaded", title: "Loaded", type: "text", mime: "text/html", isProtected: false, blobId: "" }],
            branches: [],
            attributes: []
        })) as typeof server.post;
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});

        const notes = await froca.getNotes([known.noteId, "gn-loaded", "gn-loaded", "gn-unresolved"]);

        expect(server.post).toHaveBeenCalledWith("tree/load", { noteIds: ["gn-loaded", "gn-unresolved"] });
        expect(notes.map((n) => n.noteId).sort()).toEqual(["gn-known", "gn-loaded"]);
        expect(trace).toHaveBeenCalled();
    });

    it("getNotes silently drops unknowns when silentNotFoundError is set", async () => {
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
        const notes = await froca.getNotes(["gn-silent"], true);
        expect(notes).toEqual([]);
        expect(trace).not.toHaveBeenCalled();
    });

    it("noteExists reflects whether the note resolves", async () => {
        const note = buildNote({ id: "ne-yes", title: "Yes" });
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        await expect(froca.noteExists(note.noteId)).resolves.toBe(true);
        await expect(froca.noteExists("ne-no")).resolves.toBe(false);
    });

    it("getNote handles 'none', falsy ids, and real ids", async () => {
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
        await expect(froca.getNote("none")).resolves.toBeNull();
        await expect(froca.getNote("")).resolves.toBeNull();
        expect(trace).toHaveBeenCalledTimes(2);

        const note = buildNote({ id: "gn-real", title: "Real" });
        await expect(froca.getNote(note.noteId)).resolves.toBe(note);
    });

    it("getNoteFromCache throws on empty id and returns the cached note otherwise", () => {
        expect(() => froca.getNoteFromCache("")).toThrow(/Empty noteId/);
        const note = buildNote({ id: "gnfc", title: "Cached" });
        expect(froca.getNoteFromCache(note.noteId)).toBe(note);
    });
});

describe("getBranches / getBranch", () => {
    it("returns existing branches and filters/handles missing ones", () => {
        const note = buildNote({
            id: "gb-parent",
            title: "Parent",
            children: [{ id: "gb-child", title: "Child" }]
        });
        const branchId = note.childToBranch["gb-child"];
        const logErrorSpy = vi.spyOn(globalThis as any, "logError").mockImplementation(() => {});

        const branches = froca.getBranches([branchId, "gb-missing"]);
        expect(branches).toHaveLength(1);
        expect(branches[0].branchId).toBe(branchId);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);

        logErrorSpy.mockClear();
        const silent = froca.getBranches(["gb-missing-2"], true);
        expect(silent).toEqual([]);
        expect(logErrorSpy).not.toHaveBeenCalled();
    });
});

describe("getBranchId", () => {
    it("short-circuits the root note", async () => {
        await expect(froca.getBranchId("anything", "root")).resolves.toBe("none_root");
    });

    it("resolves the parent->branch mapping for a real child", async () => {
        const note = buildNote({
            id: "gbi-parent",
            title: "Parent",
            children: [{ id: "gbi-child", title: "Child" }]
        });
        const expected = froca.notes["gbi-child"].parentToBranch["gbi-parent"];
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        await expect(froca.getBranchId("gbi-parent", "gbi-child")).resolves.toBe(expected);
    });

    it("logs and returns null when the child cannot be found", async () => {
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        const logErrorSpy = vi.spyOn(globalThis as any, "logError").mockImplementation(() => {});
        await expect(froca.getBranchId("gbi-p", "gbi-ghost")).resolves.toBeNull();
        expect(logErrorSpy).toHaveBeenCalled();
    });
});

describe("getAttachment / getAttachmentsForNote / processAttachmentRows", () => {
    function attRow(attachmentId: string, ownerId = "att-owner") {
        return {
            attachmentId,
            ownerId,
            role: "file",
            mime: "text/plain",
            title: "att",
            dateModified: "2025-01-01",
            utcDateModified: "2025-01-01",
            utcDateScheduledForErasureSince: "2025-01-01",
            contentLength: 1
        } as any;
    }

    it("returns a cached attachment without hitting the server", async () => {
        froca.attachments["cached-att"] = { attachmentId: "cached-att" } as any;
        server.getWithSilentNotFound = vi.fn(async () => {
            throw new Error("should not be called");
        }) as typeof server.getWithSilentNotFound;

        const att = await froca.getAttachment("cached-att");
        expect(att).toBe(froca.attachments["cached-att"]);
    });

    it("loads all attachments for a note and links them to the owner note", async () => {
        const owner = buildNote({ id: "att-owner", title: "Owner" });
        server.getWithSilentNotFound = vi.fn(async () => [attRow("loaded-att", owner.noteId)]) as typeof server.getWithSilentNotFound;

        const att = await froca.getAttachment("loaded-att");
        expect(att?.attachmentId).toBe("loaded-att");
        expect(server.getWithSilentNotFound).toHaveBeenCalledWith("attachments/loaded-att/all");
        expect(owner.attachments?.map((a) => a.attachmentId)).toContain("loaded-att");
    });

    it("does not link attachments when the load returns nothing", async () => {
        server.getWithSilentNotFound = vi.fn(async () => []) as typeof server.getWithSilentNotFound;
        const att = await froca.getAttachment("empty-load-att");
        expect(att).toBeUndefined();
    });

    it("returns null on not-found when silentNotFoundError is set, otherwise rethrows", async () => {
        server.getWithSilentNotFound = vi.fn(async () => {
            throw new Error("404");
        }) as typeof server.getWithSilentNotFound;

        await expect(froca.getAttachment("missing-att", true)).resolves.toBeNull();
        await expect(froca.getAttachment("missing-att")).rejects.toThrow("404");
    });

    it("getAttachmentsForNote maps the rows", async () => {
        server.get = vi.fn(async () => [attRow("for-note-att")]) as typeof server.get;
        const out = await froca.getAttachmentsForNote("att-owner");
        expect(server.get).toHaveBeenCalledWith("notes/att-owner/attachments");
        expect(out.map((a) => a.attachmentId)).toEqual(["for-note-att"]);
    });

    it("processAttachmentRows updates existing rows and creates new ones", () => {
        const first = froca.processAttachmentRows([attRow("proc-att")]);
        expect(first[0].title).toBe("att");

        const updatedRow = { ...attRow("proc-att"), title: "updated" };
        const second = froca.processAttachmentRows([updatedRow]);
        expect(second[0]).toBe(first[0]); // same instance, updated in place
        expect(second[0].title).toBe("updated");
    });
});

describe("getBlob", () => {
    it("fetches and caches the blob promise, and serves a second call from cache", async () => {
        server.getWithSilentNotFound = vi.fn(async () => ({ blobId: "blob-1", content: "hi", contentLength: 2 })) as typeof server.getWithSilentNotFound;

        const blob1 = await froca.getBlob("notes", "blob-note");
        const blob2 = await froca.getBlob("notes", "blob-note");

        expect(server.getWithSilentNotFound).toHaveBeenCalledTimes(1);
        expect(server.getWithSilentNotFound).toHaveBeenCalledWith("notes/blob-note/blob");
        expect(blob1).not.toBeNull();
        expect(blob2).toBe(blob1);
    });

    it("clears the cached blob promise after the cleanup timeout fires", async () => {
        vi.useFakeTimers();
        try {
            server.getWithSilentNotFound = vi.fn(async () => ({ blobId: "blob-2", content: "x", contentLength: 1 })) as typeof server.getWithSilentNotFound;

            await froca.getBlob("notes", "blob-cleanup");
            // The .then() that schedules the cleanup setTimeout runs on a microtask.
            await vi.advanceTimersByTimeAsync(1000);

            expect(froca.blobPromises["notes-blob-cleanup"]).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("returns null and logs when the blob request fails", async () => {
        server.getWithSilentNotFound = vi.fn(async () => {
            throw new Error("blob boom");
        }) as typeof server.getWithSilentNotFound;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const blob = await froca.getBlob("notes", "blob-fail");
        expect(blob).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
    });
});
