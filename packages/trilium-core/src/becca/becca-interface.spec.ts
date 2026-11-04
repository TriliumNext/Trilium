import { describe, expect, it } from "vitest";

import becca from "./becca.js";
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
            const withHash = becca.findAttributes("label", "#archived");
            const withoutHash = becca.findAttributes("label", "archived");
            expect(Array.isArray(withHash)).toBe(true);
            expect(withHash).toEqual(withoutHash);
        });

        it("strips a leading '~' from the name before lookup", () => {
            const withTilde = becca.findAttributes("relation", "~template");
            const withoutTilde = becca.findAttributes("relation", "template");
            expect(Array.isArray(withTilde)).toBe(true);
            expect(withTilde).toEqual(withoutTilde);
        });

        it("returns an empty array when nothing matches", () => {
            expect(becca.findAttributes("label", "definitely-missing-xyz")).toEqual([]);
        });
    });

    describe("getNotes", () => {
        it("skips missing ids when ignoreMissing is true", () => {
            const { note } = createNote("root");
            const result = becca.getNotes([note.noteId, "missing-note-id"], true);
            expect(result.map((n) => n.noteId)).toEqual([note.noteId]);
        });

        it("throws on a missing id when ignoreMissing is false", () => {
            expect(() => becca.getNotes(["missing-note-id"], false)).toThrow();
        });

        it("defaults ignoreMissing to false (throws)", () => {
            expect(() => becca.getNotes(["another-missing-id"])).toThrow();
        });
    });

    describe("getAttributeOrThrow", () => {
        it("throws when the attribute does not exist", () => {
            expect(() => becca.getAttributeOrThrow("missing-attribute-id")).toThrow();
        });

        it("returns the attribute when present", () => {
            const { note } = createNote("root");
            const attr = getContext().init(() => note.addLabel("becca-interface-label"));
            const fetched = becca.getAttributeOrThrow(attr.attributeId);
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

            const fetched = becca.getAttachments([attachment.attachmentId]);
            expect(fetched.map((a) => a.attachmentId)).toContain(attachment.attachmentId);
        });

        it("getBlob returns null when no blobId is provided", () => {
            expect(becca.getBlob({})).toBeNull();
        });

        it("getBlob returns null when the blobId has no matching row", () => {
            expect(becca.getBlob({ blobId: "missing-blob-id" })).toBeNull();
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
            const blob = becca.getBlob({ blobId: attachment.blobId });
            expect(blob).not.toBeNull();
            expect(blob?.blobId).toBe(attachment.blobId);
        });
    });

    describe("getEntity", () => {
        it("returns null when entityName is empty", () => {
            expect(becca.getEntity("", "someId")).toBeNull();
        });

        it("returns null when entityId is empty", () => {
            expect(becca.getEntity("notes", "")).toBeNull();
        });

        it("resolves a note through the camelCase collection lookup", () => {
            const { note } = createNote("root");
            const entity = becca.getEntity("notes", note.noteId);
            expect(entity).not.toBeNull();
            expect((entity as { noteId?: string })?.noteId).toBe(note.noteId);
        });

        it("returns null for a known collection when the id is absent", () => {
            expect(becca.getEntity("notes", "missing-note-id")).toBeNull();
        });

        it("routes 'revisions' to getRevision", () => {
            // No such revision exists, but the branch is exercised and returns null.
            expect(becca.getEntity("revisions", "missing-revision-id")).toBeNull();
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

            const entity = becca.getEntity("attachments", attachment.attachmentId);
            expect(entity).not.toBeNull();
            expect((entity as { attachmentId?: string })?.attachmentId).toBe(attachment.attachmentId);
        });

        it("converts snake_case entity names to camelCase collections (etapi_tokens)", () => {
            // The etapiTokens collection exists on becca; a missing id yields null,
            // proving the snake_case -> camelCase conversion resolved a real collection.
            expect(becca.getEntity("etapi_tokens", "missing-token-id")).toBeNull();
        });

        it("throws for an entity name that maps to no collection", () => {
            expect(() => becca.getEntity("totally_unknown_entity", "id")).toThrow();
        });
    });

    describe("dirtyNoteFlatText / getFlatTextIndex", () => {
        it("schedules an incremental update when the index already exists", () => {
            const { note } = createNote("root");
            // Build the index first so flatTextIndex is non-null.
            becca.getFlatTextIndex();

            becca.dirtyNoteFlatText(note.noteId);
            expect(becca.dirtyFlatTextNoteIds.has(note.noteId)).toBe(true);
        });

        it("builds the full index on first access and includes created notes", () => {
            const { note } = createNote("root");
            // Force a full rebuild by invalidating the note set.
            becca.dirtyNoteSetCache();

            const index = becca.getFlatTextIndex();
            expect(index.notes.length).toBeGreaterThan(0);
            expect(index.flatTexts.length).toBe(index.notes.length);
            expect(index.noteIdToIdx.has(note.noteId)).toBe(true);
        });

        it("recomputes only dirtied notes on the incremental path", () => {
            const { note } = createNote("root");
            // Ensure the index exists.
            becca.getFlatTextIndex();

            // Dirty an existing note id (in the index) so the incremental branch runs.
            becca.dirtyNoteFlatText(note.noteId);
            // Also dirty an id that is not present in the index map (idx === undefined branch).
            becca.dirtyFlatTextNoteIds.add("not-in-index-id");

            const idx = becca.getFlatTextIndex().noteIdToIdx.get(note.noteId);
            expect(idx).toBeDefined();
            // After recompute the dirty set is cleared.
            expect(becca.dirtyFlatTextNoteIds.size).toBe(0);
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
                becca.dirtyNoteSetCache(); // force a full rebuild
                const index = becca.getFlatTextIndex();
                expect(index.notes.length).toBeGreaterThan(0);
            } finally {
                proc.memoryUsage = original;
            }
        });
    });
});
