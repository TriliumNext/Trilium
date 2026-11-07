import { describe, expect, it } from "vitest";

import { getBecca } from "./becca.js";
import { getContext } from "../services/context.js";
import noteService from "../services/notes.js";

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string, title?: string) {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: title ?? `becca-interface-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        })
    );
}

describe("Becca interface (real DB)", () => {
    describe("findAttributes", () => {
        it("strips a leading '#' from the name before lookup", () => {
            // There is a #label attribute somewhere in the fixture; even if not,
            // the goal is to exercise the '#'/'~' stripping branch. We assert the
            // result is an array and the lookup is equivalent to the unprefixed key.
            const withHash = getBecca().findAttributes("label", "#archived");
            const withoutHash = getBecca().findAttributes("label", "archived");
            expect(Array.isArray(withHash)).toBe(true);
            expect(withHash).toEqual(withoutHash);
        });

        it("strips a leading '~' from the name before lookup", () => {
            const withTilde = getBecca().findAttributes("relation", "~template");
            const withoutTilde = getBecca().findAttributes("relation", "template");
            expect(Array.isArray(withTilde)).toBe(true);
            expect(withTilde).toEqual(withoutTilde);
        });

        it("returns an empty array when nothing matches", () => {
            expect(getBecca().findAttributes("label", "definitely-missing-xyz")).toEqual([]);
        });
    });

    describe("getNotes", () => {
        it("skips missing ids when ignoreMissing is true", () => {
            const { note } = createNote("root");
            const result = getBecca().getNotes([note.noteId, "missing-note-id"], true);
            expect(result.map((n) => n.noteId)).toEqual([note.noteId]);
        });

        it("throws on a missing id when ignoreMissing is false", () => {
            expect(() => getBecca().getNotes(["missing-note-id"], false)).toThrow();
        });

        it("defaults ignoreMissing to false (throws)", () => {
            expect(() => getBecca().getNotes(["another-missing-id"])).toThrow();
        });
    });

    describe("getAttributeOrThrow", () => {
        it("throws when the attribute does not exist", () => {
            expect(() => getBecca().getAttributeOrThrow("missing-attribute-id")).toThrow();
        });

        it("returns the attribute when present", () => {
            const { note } = createNote("root");
            const attr = getContext().init(() => note.addLabel("becca-interface-label"));
            const fetched = getBecca().getAttributeOrThrow(attr.attributeId);
            expect(fetched.attributeId).toBe(attr.attributeId);
        });
    });

    describe("getAttachments / getBlob", () => {
        it("fetches existing attachments by id via getManyRows", () => {
            const { note } = createNote("root");
            const attachment = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: `becca-interface-att-${counter}`,
                    content: "attachment content"
                })
            );

            const fetched = getBecca().getAttachments([attachment.attachmentId]);
            expect(fetched.map((a) => a.attachmentId)).toContain(attachment.attachmentId);
        });

        it("getBlob returns null when no blobId is provided", () => {
            expect(getBecca().getBlob({})).toBeNull();
        });

        it("getBlob returns null when the blobId has no matching row", () => {
            expect(getBecca().getBlob({ blobId: "missing-blob-id" })).toBeNull();
        });

        it("getBlob returns a blob for a saved attachment's blobId", () => {
            const { note } = createNote("root");
            const attachment = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: `becca-interface-blob-${counter}`,
                    content: "blob content"
                })
            );

            expect(attachment.blobId).toBeDefined();
            const blob = getBecca().getBlob({ blobId: attachment.blobId });
            expect(blob).not.toBeNull();
            expect(blob?.blobId).toBe(attachment.blobId);
        });
    });

    describe("getEntity", () => {
        it("returns null when entityName is empty", () => {
            expect(getBecca().getEntity("", "someId")).toBeNull();
        });

        it("returns null when entityId is empty", () => {
            expect(getBecca().getEntity("notes", "")).toBeNull();
        });

        it("resolves a note through the camelCase collection lookup", () => {
            const { note } = createNote("root");
            const entity = getBecca().getEntity("notes", note.noteId);
            expect(entity).not.toBeNull();
            expect((entity as { noteId?: string })?.noteId).toBe(note.noteId);
        });

        it("returns null for a known collection when the id is absent", () => {
            expect(getBecca().getEntity("notes", "missing-note-id")).toBeNull();
        });

        it("routes 'revisions' to getRevision", () => {
            // No such revision exists, but the branch is exercised and returns null.
            expect(getBecca().getEntity("revisions", "missing-revision-id")).toBeNull();
        });

        it("routes 'attachments' to getAttachment", () => {
            const { note } = createNote("root");
            const attachment = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: `becca-interface-entity-att-${counter}`,
                    content: "x"
                })
            );

            const entity = getBecca().getEntity("attachments", attachment.attachmentId);
            expect(entity).not.toBeNull();
            expect((entity as { attachmentId?: string })?.attachmentId).toBe(attachment.attachmentId);
        });

        it("converts snake_case entity names to camelCase collections (etapi_tokens)", () => {
            // The etapiTokens collection exists on becca; a missing id yields null,
            // proving the snake_case -> camelCase conversion resolved a real collection.
            expect(getBecca().getEntity("etapi_tokens", "missing-token-id")).toBeNull();
        });

        it("throws for an entity name that maps to no collection", () => {
            expect(() => getBecca().getEntity("totally_unknown_entity", "id")).toThrow();
        });
    });

    describe("dirtyNoteFlatText / getFlatTextIndex", () => {
        it("schedules an incremental update when the index already exists", () => {
            const { note } = createNote("root");
            // Build the index first so flatTextIndex is non-null.
            getBecca().getFlatTextIndex();

            getBecca().dirtyNoteFlatText(note.noteId);
            expect(getBecca().dirtyFlatTextNoteIds.has(note.noteId)).toBe(true);
        });

        it("builds the full index on first access and includes created notes", () => {
            const { note } = createNote("root");
            // Force a full rebuild by invalidating the note set.
            getBecca().dirtyNoteSetCache();

            const index = getBecca().getFlatTextIndex();
            expect(index.notes.length).toBeGreaterThan(0);
            expect(index.flatTexts.length).toBe(index.notes.length);
            expect(index.noteIdToIdx.has(note.noteId)).toBe(true);
        });

        it("recomputes only dirtied notes on the incremental path", () => {
            const { note } = createNote("root");
            // Ensure the index exists.
            getBecca().getFlatTextIndex();

            // Dirty an existing note id (in the index) so the incremental branch runs.
            getBecca().dirtyNoteFlatText(note.noteId);
            // Also dirty an id that is not present in the index map (idx === undefined branch).
            getBecca().dirtyFlatTextNoteIds.add("not-in-index-id");

            const idx = getBecca().getFlatTextIndex().noteIdToIdx.get(note.noteId);
            expect(idx).toBeDefined();
            // After recompute the dirty set is cleared.
            expect(getBecca().dirtyFlatTextNoteIds.size).toBe(0);
        });

        it("builds the index without heap logging when process.memoryUsage is unavailable", () => {
            // Under the standalone (WASM/browser) runtime process.memoryUsage is undefined,
            // so the heapBefore === null fallback (no heap-delta log) is taken. Simulate that
            // here so the same branch is covered under Node too.
            createNote("root");

            const proc = process as unknown as { memoryUsage?: unknown };
            const original = proc.memoryUsage;
            proc.memoryUsage = undefined;

            try {
                getBecca().dirtyNoteSetCache(); // force a full rebuild
                const index = getBecca().getFlatTextIndex();
                expect(index.notes.length).toBeGreaterThan(0);
            } finally {
                proc.memoryUsage = original;
            }
        });
    });
});
