import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError } from "../errors.js";
import blob from "./blob.js";
import { getContext } from "./context.js";
import protectedSessionService from "./protected_session.js";
import dataEncryption from "./encryption/data_encryption.js";
import notesService from "./notes.js";
import { decodeUtf8, encodeUtf8 } from "./utils/binary.js";
import { hash } from "./utils/index.js";

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
    });
});
