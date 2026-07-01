import { afterEach, describe, expect, it, vi } from "vitest";

import { getContext } from "../services/context.js";
import eventService from "../services/events.js";
import noteService from "../services/notes.js";
import { getSql } from "../services/sql/index.js";
import ws from "../services/ws.js";
import { getBecca } from "./becca.js";
import beccaLoader, { load, reload } from "./becca_loader.js";
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
        // The shared fixture DB is loaded (getBecca().loaded === true) after setup;
        // some tests flip this, so always restore it.
        getBecca().loaded = true;
        vi.restoreAllMocks();
    });

    describe("ENTITY_CHANGE_SYNCED listener", () => {
        it("returns early without touching becca when becca is not loaded", () => {
            getBecca().loaded = false;

            const before = Object.keys(getBecca().notes).length;
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
            expect(getBecca().getNote("loaderNotLoaded")).toBeNull();
            expect(Object.keys(getBecca().notes).length).toBe(before);
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

            const updated = getBecca().getNoteOrThrow(note.noteId);
            expect(updated.title).toBe("synced-updated-title");
            expect(updated.type).toBe("code");
        });

        it("creates a brand-new becca entity from a synced row when not yet present", () => {
            const newNoteId = "loaderBrandNew1";
            expect(getBecca().getNote(newNoteId)).toBeNull();

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

            const created = getBecca().getNoteOrThrow(newNoteId);
            expect(created).toBeInstanceOf(BNote);
            expect(created.title).toBe("brand-new");
            // init() ran, so the derived collections are initialised.
            expect(Array.isArray(created.children)).toBe(true);
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
            const branchesBefore = Object.keys(getBecca().branches).length;

            expect(() =>
                eventService.emit(eventService.ENTITY_DELETED, {
                    entityName: "branches",
                    entityId: "nope-no-such-branch"
                })
            ).not.toThrow();

            // No branches were removed.
            expect(Object.keys(getBecca().branches).length).toBe(branchesBefore);
        });

        it("attributeDeleted returns early for an unknown attribute id", () => {
            const attributesBefore = Object.keys(getBecca().attributes).length;

            expect(() =>
                eventService.emit(eventService.ENTITY_DELETED, {
                    entityName: "attributes",
                    entityId: "nope-no-such-attribute"
                })
            ).not.toThrow();

            expect(Object.keys(getBecca().attributes).length).toBe(attributesBefore);
        });
    });

    describe("ENTER_PROTECTED_SESSION listener", () => {
        it("swallows errors thrown while decrypting protected notes", () => {
            const spy = vi.spyOn(getBecca(), "decryptProtectedNotes").mockImplementation(() => {
                throw new Error("boom");
            });

            // The error must be caught inside the listener (and additionally by
            // the event dispatcher), so emitting never throws.
            expect(() => eventService.emit(eventService.ENTER_PROTECTED_SESSION)).not.toThrow();
            expect(spy).toHaveBeenCalled();
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

            const token = getBecca().getEtapiToken(etapiTokenId);
            expect(token).not.toBeNull();
            expect(token?.name).toBe("loader-test-token");
            expect(getBecca().loaded).toBe(true);
        });
    });

    describe("reload()", () => {
        it("reloads becca and notifies the frontend with the supplied reason", () => {
            const spy = vi.spyOn(ws, "reloadFrontend").mockImplementation(() => {});

            getContext().init(() => reload("custom reason"));

            expect(getBecca().loaded).toBe(true);
            expect(spy).toHaveBeenCalledWith("custom reason");
        });

        it("falls back to a default reason when none is given", () => {
            const spy = vi.spyOn(ws, "reloadFrontend").mockImplementation(() => {});

            getContext().init(() => reload(""));

            // The empty reason triggers the `reason || "becca reloaded"` fallback.
            expect(spy).toHaveBeenCalledWith("becca reloaded");
        });
    });

    it("exposes load and reload through the default export", () => {
        expect(typeof beccaLoader.load).toBe("function");
        expect(typeof beccaLoader.reload).toBe("function");
        expect(beccaLoader.beccaLoaded).toBeInstanceOf(Promise);
    });
});
