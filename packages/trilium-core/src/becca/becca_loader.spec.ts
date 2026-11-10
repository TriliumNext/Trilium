import { afterEach, describe, expect, it, vi } from "vitest";

import { getContext } from "../services/context.js";
import eventService from "../services/events.js";
import { getLog } from "../services/log.js";
import noteService from "../services/notes.js";
import { getSql } from "../services/sql/index.js";
import { registerVirtualNoteProvider, unregisterVirtualNoteProvider } from "../services/virtual_notes.js";
import ws from "../services/ws.js";
import becca from "./becca.js";
import beccaLoader, { load, reload } from "./becca_loader.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import BNote from "./entities/bnote.js";

let counter = 0;

function createNote(parentNoteId: string): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `becca-loader-spec-${counter}`,
            content: "<p>hi</p>",
            type: "text"
        }).note
    );
}

describe("becca_loader", () => {
    afterEach(() => {
        // The shared fixture DB is loaded (becca.loaded === true) after setup;
        // some tests flip this, so always restore it.
        becca.loaded = true;
        vi.restoreAllMocks();
    });

    describe("ENTITY_CHANGE_SYNCED listener", () => {
        it("returns early without touching becca when becca is not loaded", () => {
            becca.loaded = false;

            const before = Object.keys(becca.notes).length;
            eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                entityName: "notes",
                entityRow: {
                    noteId: "loaderNotLoaded",
                    title: "x",
                    type: "text",
                    mime: "text/html",
                    isProtected: false,
                    blobId: ""
                }
            });

            // Nothing was created since the listener bailed out.
            expect(becca.getNote("loaderNotLoaded")).toBeNull();
            expect(Object.keys(becca.notes).length).toBe(before);
        });

        it("updates an existing becca entity from the synced row", () => {
            const note = createNote("root");

            eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                entityName: "notes",
                entityRow: {
                    noteId: note.noteId,
                    title: "synced-updated-title",
                    type: "code",
                    mime: "text/plain",
                    isProtected: false,
                    blobId: note.blobId
                }
            });

            const updated = becca.getNoteOrThrow(note.noteId);
            expect(updated.title).toBe("synced-updated-title");
            expect(updated.type).toBe("code");
        });

        it("creates a brand-new becca entity from a synced row when not yet present", () => {
            const newNoteId = "loaderBrandNew1";
            expect(becca.getNote(newNoteId)).toBeNull();

            eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                entityName: "notes",
                entityRow: {
                    noteId: newNoteId,
                    title: "brand-new",
                    type: "text",
                    mime: "text/html",
                    isProtected: false,
                    blobId: ""
                }
            });

            const created = becca.getNoteOrThrow(newNoteId);
            expect(created).toBeInstanceOf(BNote);
            expect(created.title).toBe("brand-new");
            // init() ran, so the derived collections are initialised.
            expect(Array.isArray(created.children)).toBe(true);
        });

        it("registers a newly synced option under its name", () => {
            expect(becca.getOption("loaderSyncedOption")).toBeNull();

            eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                entityName: "options",
                entityRow: { name: "loaderSyncedOption", value: "synced", isSynced: true, utcDateModified: "2024-01-01 00:00:00.000Z" }
            });

            try {
                expect(becca.getOption("loaderSyncedOption")?.value).toBe("synced");
                expect(Object.keys(becca.options)).not.toContain("undefined");
            } finally {
                delete becca.options.loaderSyncedOption;
            }
        });

        it("ignores synced rows for entity names outside the handled set", () => {
            // "blobs" is a valid entity but not in the becca_loader handled list,
            // so neither the create/update branch nor post-processing should run.
            expect(() =>
                eventService.emit(eventService.ENTITY_CHANGE_SYNCED, {
                    entityName: "blobs",
                    entityRow: { blobId: "loaderIgnoredBlob" }
                })
            ).not.toThrow();
        });
    });

    describe("ENTITY_DELETED listener", () => {
        it("branchDeleted returns early for an unknown branch id", () => {
            const branchesBefore = Object.keys(becca.branches).length;

            expect(() =>
                eventService.emit(eventService.ENTITY_DELETED, {
                    entityName: "branches",
                    entityId: "nope-no-such-branch"
                })
            ).not.toThrow();

            // No branches were removed.
            expect(Object.keys(becca.branches).length).toBe(branchesBefore);
        });

        it("attributeDeleted returns early for an unknown attribute id", () => {
            const attributesBefore = Object.keys(becca.attributes).length;

            expect(() =>
                eventService.emit(eventService.ENTITY_DELETED, {
                    entityName: "attributes",
                    entityId: "nope-no-such-attribute"
                })
            ).not.toThrow();

            expect(Object.keys(becca.attributes).length).toBe(attributesBefore);
        });

        it("attributeDeleted removes an attribute from its index bucket without rebuilding it", () => {
            const makeLabel = (attributeId: string, noteId: string) => new BAttribute({
                attributeId, noteId, type: "label", name: "loaderSharedLabel",
                value: "", isInheritable: false, position: 0
            });
            const deleteAttribute = (attribute: BAttribute) => eventService.emit(
                eventService.ENTITY_DELETED,
                { entityName: "attributes", entityId: attribute.attributeId, entity: attribute }
            );

            const first = makeLabel("loaderShared1", "loaderSharedNote1");
            const second = makeLabel("loaderShared2", "loaderSharedNote2");
            const third = makeLabel("loaderShared3", "loaderSharedNote1");
            const bucket = becca.attributeIndex["label-loadersharedlabel"];

            deleteAttribute(second);

            // Rebuilding the bucket per deletion makes deleting n same-named attributes O(n²).
            expect(becca.attributeIndex["label-loadersharedlabel"]).toBe(bucket);
            expect(becca.findAttributes("label", "loaderSharedLabel")).toEqual([ first, third ]);
            expect(becca.getNote("loaderSharedNote2")).toBeNull();

            deleteAttribute(first);
            deleteAttribute(third);
            expect(becca.findAttributes("label", "loaderSharedLabel")).toEqual([]);
        });
    });

    describe("ENTER_PROTECTED_SESSION listener", () => {
        it("swallows errors thrown while decrypting protected notes", () => {
            const spy = vi.spyOn(becca, "decryptProtectedNotes").mockImplementation(() => {
                throw new Error("boom");
            });

            // The error must be caught inside the listener (and additionally by
            // the event dispatcher), so emitting never throws.
            expect(() => eventService.emit(eventService.ENTER_PROTECTED_SESSION)).not.toThrow();
            expect(spy).toHaveBeenCalled();
        });
    });

    describe("LEAVE_PROTECTED_SESSION listener", () => {
        it("reloads becca from disk, purging decrypted titles from memory and the flat-text index", () => {
            // Simulate the post-unlock state: a protected note whose plaintext title lives
            // only in becca memory (on disk the title is ciphertext, here it has no row at all).
            const note = new BNote();
            note.updateFromRow({
                noteId: "loaderLeaveProtected",
                title: "swordfish plaintext",
                isProtected: true,
                type: "text",
                mime: "text/html",
                blobId: ""
            });
            note.init();
            note.isDecrypted = true;

            // The flat-text search index serves the plaintext title (this is the #10115
            // leak surface: title-word search matching protected notes without a session).
            expect(becca.getFlatTextIndex().flatTexts.some((text) => text.includes("swordfish"))).toBe(true);

            getContext().init(() => eventService.emit(eventService.LEAVE_PROTECTED_SESSION));

            // Full reload from disk: the memory-only decrypted state is discarded...
            expect(becca.getNote("loaderLeaveProtected")).toBeNull();
            // ...and the rebuilt search index no longer matches the plaintext.
            expect(becca.getFlatTextIndex().flatTexts.some((text) => text.includes("swordfish"))).toBe(false);
        });
    });

    describe("load()", () => {
        it("loads etapi tokens into becca", () => {
            const etapiTokenId = "loaderEtapiToken1";
            const now = "2025-01-01 00:00:00.000Z";

            getContext().init(() => {
                getSql().execute(
                    /*sql*/`INSERT INTO etapi_tokens (etapiTokenId, name, tokenHash, utcDateCreated, utcDateModified, isDeleted)
                            VALUES (?, ?, ?, ?, ?, 0)`,
                    [etapiTokenId, "loader-test-token", "hash-value", now, now]
                );

                load();
            });

            const token = becca.getEtapiToken(etapiTokenId);
            expect(token).not.toBeNull();
            expect(token?.name).toBe("loader-test-token");
            expect(becca.loaded).toBe(true);
        });

        it("orders a note's children by notePosition rather than by insertion order", () => {
            const parent = createNote("root");
            const children = [
                createNote(parent.noteId), createNote(parent.noteId), createNote(parent.noteId)
            ];

            getContext().init(() => {
                // Reverse the positions, so the rowid order the table is scanned in disagrees
                // with the order the children belong in.
                const update = /*sql*/`UPDATE branches SET notePosition = ?
                                       WHERE noteId = ? AND parentNoteId = ?`;
                for (const [index, child] of children.entries()) {
                    const position = (children.length - index) * 10;
                    getSql().execute(update, [position, child.noteId, parent.noteId]);
                }

                load();
            });

            const loadedParent = becca.getNoteOrThrow(parent.noteId);
            expect(loadedParent.children.map((child) => child.noteId)).toEqual(
                [...children].reverse().map((child) => child.noteId)
            );
        });
    });

    describe("reload()", () => {
        it("reloads becca and has the clients refresh froca with the supplied reason", () => {
            const refresh = vi.spyOn(ws, "reloadFroca").mockImplementation(() => {});
            const fullReload = vi.spyOn(ws, "reloadFrontend").mockImplementation(() => {});

            getContext().init(() => reload("custom reason"));

            expect(becca.loaded).toBe(true);
            expect(refresh).toHaveBeenCalledWith("custom reason");
            expect(fullReload).not.toHaveBeenCalled();
        });

        it("falls back to a default reason when none is given", () => {
            const spy = vi.spyOn(ws, "reloadFroca").mockImplementation(() => {});

            getContext().init(() => reload(""));

            expect(spy).toHaveBeenCalledWith("becca reloaded");
        });
    });

    describe("note update", () => {
        it("drops the title-derived search caches so a rename is searchable under its new title", () => {
            const note = createNote("root");
            // Populate both caches, as a search would.
            expect(note.getFlatText()).toContain("becca-loader-spec");

            expect(note.getSearchableTitle().normalized).toBe(note.title.toLowerCase());

            // A local rename assigns the title and saves; `updateFromRow` is not involved.
            note.title = "Renamed Vienna";
            getContext().init(() => note.save());

            expect(note.getSearchableTitle().normalized).toBe("renamed vienna");
            expect(note.getSearchableTitle().words).toEqual([ "renamed", "vienna" ]);
            expect(note.getFlatText()).toContain("renamed vienna");
        });
    });

    describe("updates and deletions of entities missing from becca", () => {
        it("skips the cache invalidation of notes that are not loaded", () => {
            const emitChanged = (entityName: string, entity: Record<string, string>) =>
                eventService.emit(eventService.ENTITY_CHANGED, { entityName, entity });

            expect(() => {
                emitChanged("notes", { noteId: "ldrGhostNote" });
                emitChanged("branches", { branchId: "ldrGhostBranch", noteId: "ldrGhostNote", parentNoteId: "ldrGhostParent" });
                emitChanged("attributes", { attributeId: "ldrGhostAttr", noteId: "ldrGhostNote" });
            }).not.toThrow();
            expect(becca.getNote("ldrGhostNote")).toBeNull();
        });

        it("deletes a branch whose parent note is no longer loaded", () => {
            const child = createNote("root");
            const branch = new BBranch({ branchId: "ldrOrphanBranch", noteId: child.noteId, parentNoteId: "ldrGonePar", notePosition: 10 });
            delete becca.notes.ldrGonePar;

            eventService.emit(eventService.ENTITY_DELETED, { entityName: "branches", entityId: "ldrOrphanBranch", entity: branch });

            expect(becca.branches.ldrOrphanBranch).toBeUndefined();
            expect(child.parentBranches).not.toContain(branch);
        });
    });

    describe("virtual subtree injection", () => {
        const reloadBecca = () => getContext().init(() => load());

        afterEach(() => {
            for (const namespace of [ "_vldr", "_brokenStr", "_brokenNoStack" ]) {
                unregisterVirtualNoteProvider(namespace);
            }
            getSql().execute("DELETE FROM branches WHERE branchId = 'vldrSkeletonBranch'");
            reloadBecca();
        });

        it("fills skeletons in place, places repeated items once per parent and survives broken providers", () => {
            const anchor = createNote("root");
            getSql().execute(
                "INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, prefix, isExpanded, isDeleted, utcDateModified) VALUES ('vldrSkeletonBranch', '_vldrSkel', ?, 50, NULL, 0, 0, '2024-01-01 00:00:00.000Z')",
                [ anchor.noteId ]
            );
            registerVirtualNoteProvider({
                namespace: "_vldr",
                parentNoteId: anchor.noteId,
                getSubtree: () => [
                    {
                        id: "_vldr",
                        title: "Root",
                        type: "text",
                        attributes: [ { type: "label", name: "vldrFlag" }, { type: "label", name: "vldrFlag", value: "second" } ],
                        children: [
                            { id: "_vldrChild", title: "Child", type: "text" },
                            { id: "_vldrChild", title: "Same place again", type: "text" }
                        ]
                    },
                    { id: "_vldrSkel", title: "Skeleton", type: "text" }
                ],
                getContent: () => null
            });
            const stackless = new Error("no stack here");
            stackless.stack = undefined;
            registerVirtualNoteProvider({
                namespace: "_brokenStr", parentNoteId: "root", getContent: () => null,
                getSubtree: () => { throw "plain string failure"; }
            });
            registerVirtualNoteProvider({
                namespace: "_brokenNoStack", parentNoteId: "root", getContent: () => null,
                getSubtree: () => { throw stackless; }
            });
            const error = vi.spyOn(getLog(), "error").mockImplementation(() => {});

            reloadBecca();

            const skeleton = becca.getNoteOrThrow("_vldrSkel");
            expect(skeleton.isVirtual).toBe(true);
            expect(skeleton.title).toBe("Skeleton");
            expect(skeleton.getParentBranches().map((b) => b.branchId)).toContain("vldrSkeletonBranch");

            const child = becca.getNoteOrThrow("_vldrChild");
            expect(child.getParentBranches()).toHaveLength(1);
            expect(child.title).toBe("Child");
            expect(becca.getNoteOrThrow("_vldr").getOwnedLabels("vldrFlag").map((l) => [ l.attributeId, l.value ])).toEqual([
                [ "v__vldr_lvldrFlag", "" ],
                [ "v__vldr_lvldrFlag_1", "second" ]
            ]);

            const messages = error.mock.calls.map(([ message ]) => String(message));
            expect(messages.some((m) => m.endsWith("'_brokenStr' failed, skipping: plain string failure"))).toBe(true);
            expect(messages.some((m) => m.endsWith("'_brokenNoStack' failed, skipping: no stack here"))).toBe(true);
        });

        it("places the injected roots after children whose branch or position is missing", () => {
            const anchor = createNote("root");
            const originalGetChildBranches = BNote.prototype.getChildBranches;
            vi.spyOn(BNote.prototype, "getChildBranches").mockImplementation(function (this: BNote) {
                return this.noteId === anchor.noteId
                    ? [ null, { notePosition: undefined } ] as unknown as BBranch[]
                    : originalGetChildBranches.call(this);
            });
            registerVirtualNoteProvider({
                namespace: "_vldr",
                parentNoteId: anchor.noteId,
                getSubtree: () => [ { id: "_vldr", title: "Root", type: "text" } ],
                getContent: () => null
            });

            reloadBecca();

            expect(becca.branches[`${anchor.noteId}__vldr`]?.notePosition).toBe(10);
        });
    });

    it("exposes load and reload through the default export", () => {
        expect(typeof beccaLoader.load).toBe("function");
        expect(typeof beccaLoader.reload).toBe("function");
        expect(beccaLoader.beccaLoaded).toBeInstanceOf(Promise);
    });
});
