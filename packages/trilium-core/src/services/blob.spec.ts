import { EMPTY_BLOB_ID } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError } from "../errors.js";
import blob from "./blob.js";
import { getContext } from "./context.js";
import protectedSessionService from "./protected_session.js";
import dataEncryption from "./encryption/data_encryption.js";
import notesService from "./notes.js";
import { getSql } from "./sql/index.js";
import { decodeUtf8, encodeUtf8 } from "./utils/binary.js";
import { hash, hashedBlobId } from "./utils/index.js";

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

describe("blob", () => {
    describe("calculateContentHash", () => {
        it("matches the manual hash of the concatenated blobId, content and text representation", () => {
            const result = blob.calculateContentHash({
                blobId: "blob123",
                content: "hello world",
                textRepresentation: "hello world"
            });

            expect(result).toBe(hash("blob123|hello world|hello world"));
        });

        it("omits the text representation segment when it is falsy", () => {
            const params = { blobId: "blobX", content: "the content" };

            const withNull = blob.calculateContentHash({ ...params, textRepresentation: null });
            const withEmpty = blob.calculateContentHash({ ...params, textRepresentation: "" });

            // No trailing "|..." segment is appended for null/empty text representation.
            expect(withNull).toBe(hash("blobX|the content"));
            expect(withEmpty).toBe(hash("blobX|the content"));
            expect(withNull).toBe(withEmpty);
        });

        it("is deterministic and sensitive to every input", () => {
            const base = { blobId: "b", content: "c", textRepresentation: "t" };

            // Same inputs always produce the same hash.
            expect(blob.calculateContentHash(base)).toBe(blob.calculateContentHash({ ...base }));

            // Changing any single field changes the hash.
            expect(blob.calculateContentHash({ ...base, blobId: "b2" })).not.toBe(blob.calculateContentHash(base));
            expect(blob.calculateContentHash({ ...base, content: "c2" })).not.toBe(blob.calculateContentHash(base));
            expect(blob.calculateContentHash({ ...base, textRepresentation: "t2" })).not.toBe(blob.calculateContentHash(base));
        });

        it("stringifies buffer content via toString before hashing", () => {
            const content = encodeUtf8("buffer payload");

            // The implementation uses content.toString(); a Uint8Array stringifies
            // to its comma-separated byte values, not the decoded text.
            expect(blob.calculateContentHash({ blobId: "bb", content, textRepresentation: null }))
                .toBe(hash(`bb|${content.toString()}`));
        });
    });

    describe("processContent (unprotected)", () => {
        it("decodes buffer string content to text and passes through plain strings", () => {
            const buffer = encodeUtf8("héllo — 世界");

            expect(blob.processContent(buffer, false, true)).toBe("héllo — 世界");
            expect(blob.processContent("already a string", false, true)).toBe("already a string");
        });

        it("returns an empty string for null string content", () => {
            expect(blob.processContent(null, false, true)).toBe("");
        });

        it("returns binary content unchanged and substitutes a zero-length buffer for null", () => {
            const payload = Uint8Array.from([1, 2, 3, 254, 255]);
            expect(blob.processContent(payload, false, false)).toBe(payload);

            const result = blob.processContent(null, false, false) as Uint8Array;
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(0);
        });
    });

    describe("processContent (protected)", () => {
        it("blanks protected content when no protected session is available", () => {
            // No data key set -> session unavailable.
            protectedSessionService.resetDataKey();
            expect(protectedSessionService.isProtectedSessionAvailable()).toBe(false);

            // String content path: encrypted bytes are replaced by "" before decoding.
            expect(blob.processContent(encodeUtf8("secret"), true, true)).toBe("");

            // Binary path: protection blanks the content to the empty string, which
            // is not null, so the zero-length-buffer fallback is skipped and "" is
            // returned verbatim.
            expect(blob.processContent(encodeUtf8("secret"), true, false)).toBe("");
        });

        it("decrypts protected content when a protected session is available", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            try {
                const cipherText = dataEncryption.encrypt(PROTECTED_KEY, "top secret");

                // String content: decrypted bytes are then UTF-8 decoded to text.
                expect(blob.processContent(cipherText, true, true)).toBe("top secret");

                // Binary content: returns the decrypted buffer as-is.
                const binary = blob.processContent(cipherText, true, false) as Uint8Array;
                expect(decodeUtf8(binary)).toBe("top secret");
            } finally {
                protectedSessionService.resetDataKey();
            }
        });

        it("returns an empty string for null protected string content with a session", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            try {
                // decrypt(null) yields null, and the string branch maps null -> "".
                expect(blob.processContent(null, true, true)).toBe("");
            } finally {
                protectedSessionService.resetDataKey();
            }
        });
    });

    describe("getBlobPojo", () => {
        it("throws NotFoundError when the entity does not exist", () => {
            expect(() => getContext().init(() => blob.getBlobPojo("notes", "doesNotExist123"))).toThrow(NotFoundError);
        });

        it("returns the decoded string content of a text note's blob", () => {
            const { noteId, content, blobId } = getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "blob spec text note",
                    content: "<p>blob spec body</p>",
                    type: "text"
                });

                const pojo = blob.getBlobPojo("notes", note.noteId);
                return { noteId: note.noteId, content: pojo.content, blobId: pojo.blobId };
            });

            expect(content).toBe("<p>blob spec body</p>");
            expect(typeof blobId).toBe("string");
            // The seeded note is the same instance retrieved by getEntity.
            expect(becca.notes[noteId]).toBeDefined();
        });

        it("nulls out the content for a note with binary (non-string) content", () => {
            const binary = Uint8Array.from([0, 1, 2, 3, 4, 5]);

            const { pojoContent, contentLength } = getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "blob spec image note",
                    content: binary,
                    type: "image",
                    mime: "image/png"
                });

                // Sanity: an image note does not have string content.
                expect((note as BNote).hasStringContent()).toBe(false);

                const pojo = blob.getBlobPojo("notes", note.noteId);
                return { pojoContent: pojo.content, contentLength: pojo.contentLength };
            });

            // Binary blobs come back with content nulled but contentLength preserved.
            expect(pojoContent).toBeNull();
            expect(contentLength).toBeGreaterThan(0);
        });

        it("marks a blob as stubbed when content is empty but the blobId is not the empty-content hash", () => {
            const { isStubbed, blobId } = getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "blob spec stub note",
                    content: "<p>content that was withheld by the sync server</p>",
                    type: "text"
                });

                // Simulate a sync stub: the server delivered empty content, but the (content-derived)
                // blobId is still the original non-empty hash.
                getSql().execute("UPDATE blobs SET content = '' WHERE blobId = ?", [note.blobId]);

                const pojo = blob.getBlobPojo("notes", note.noteId);
                return { isStubbed: pojo.isStubbed, blobId: pojo.blobId };
            });

            expect(blobId).not.toBe(EMPTY_BLOB_ID);
            expect(isStubbed).toBe(true);
        });

        it("does not mark a normal (non-empty) blob as stubbed", () => {
            const isStubbed = getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "blob spec normal note",
                    content: "<p>ordinary content</p>",
                    type: "text"
                });
                return blob.getBlobPojo("notes", note.noteId).isStubbed;
            });

            expect(isStubbed).toBe(false);
        });

        it("does not mark a genuinely empty blob as stubbed", () => {
            const { isStubbed, blobId } = getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "blob spec empty note",
                    content: "<p>temporary</p>",
                    type: "text"
                });
                // Empty content hashes to EMPTY_BLOB_ID, so this is a legitimately empty blob, not a stub.
                note.setContent("");

                const pojo = blob.getBlobPojo("notes", note.noteId);
                return { isStubbed: pojo.isStubbed, blobId: pojo.blobId };
            });

            expect(blobId).toBe(EMPTY_BLOB_ID);
            expect(isStubbed).toBe(false);
        });
    });

    describe("getDeletedNoteBlobPojo", () => {
        function createDeletedNote(overrides: { content?: string | Uint8Array; type?: string; mime?: string } = {}) {
            const { note } = notesService.createNewNote({
                parentNoteId: "root",
                title: "deleted blob spec note",
                content: overrides.content ?? "<p>deleted note body</p>",
                type: (overrides.type ?? "text") as any,
                mime: overrides.mime
            });
            // Soft-delete only: the row and its blob survive, so the content stays readable.
            getSql().execute("UPDATE notes SET isDeleted = 1 WHERE noteId = ?", [note.noteId]);
            return note;
        }

        it("throws NotFoundError for a live (not soft-deleted) note", () => {
            expect(() => getContext().init(() => {
                const { note } = notesService.createNewNote({
                    parentNoteId: "root",
                    title: "live note",
                    content: "<p>alive</p>",
                    type: "text"
                });
                return blob.getDeletedNoteBlobPojo(note.noteId);
            })).toThrow(NotFoundError);
        });

        it("throws NotFoundError for an unknown note", () => {
            expect(() => getContext().init(() => blob.getDeletedNoteBlobPojo("doesNotExist123"))).toThrow(NotFoundError);
        });

        it("returns the decoded string content of a soft-deleted text note", () => {
            const content = getContext().init(() => blob.getDeletedNoteBlobPojo(createDeletedNote().noteId).content);
            expect(content).toBe("<p>deleted note body</p>");
        });

        it("nulls out the content for a soft-deleted binary note", () => {
            const { content, contentLength } = getContext().init(() => {
                const note = createDeletedNote({ content: Uint8Array.from([0, 1, 2, 3]), type: "image", mime: "image/png" });
                const pojo = blob.getDeletedNoteBlobPojo(note.noteId);
                return { content: pojo.content, contentLength: pojo.contentLength };
            });
            expect(content).toBeNull();
            expect(contentLength).toBeGreaterThan(0);
        });

        it("decrypts a soft-deleted protected note's content when a protected session is available, and blanks it otherwise", () => {
            const noteId = getContext().init(() => {
                const note = createDeletedNote();
                // Turn it into a protected note whose blob holds the encrypted content.
                const cipher = dataEncryption.encrypt(PROTECTED_KEY, "<p>secret deleted body</p>");
                getSql().execute("UPDATE notes SET isProtected = 1 WHERE noteId = ?", [note.noteId]);
                getSql().execute("UPDATE blobs SET content = ? WHERE blobId = ?", [cipher, note.blobId]);
                return note.noteId;
            });

            // Without a session the content is blanked, not leaked.
            protectedSessionService.resetDataKey();
            expect(getContext().init(() => blob.getDeletedNoteBlobPojo(noteId).content)).toBe("");

            // With a session it is decrypted.
            protectedSessionService.setDataKey(PROTECTED_KEY);
            try {
                expect(getContext().init(() => blob.getDeletedNoteBlobPojo(noteId).content)).toBe("<p>secret deleted body</p>");
            } finally {
                protectedSessionService.resetDataKey();
            }
        });
    });

    describe("EMPTY_BLOB_ID", () => {
        it("equals hashedBlobId of empty content", () => {
            // Guards the hard-coded constant in commons (which cannot call hashedBlobId at module load).
            expect(hashedBlobId("")).toBe(EMPTY_BLOB_ID);
        });
    });
});
