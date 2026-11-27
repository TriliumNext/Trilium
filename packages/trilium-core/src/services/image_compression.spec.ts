import { getImageAttachmentTitle, type ImageCompressionResponse, type NoteType } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BAttachment from "../becca/entities/battachment.js";
import { getContext } from "./context.js";
import { collectNoteTargets, compressAttachmentImage, compressNoteImages } from "./image_compression.js";
import { getImageProvider, type ImageProvider, initImageProvider } from "./image_provider.js";
import { getLog } from "./log.js";
import notesService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { encodeUtf8 } from "./utils/binary.js";

/**
 * The run's bookkeeping — which images it reads, how it batches its writes and what it does when one
 * of them fails — against the real in-memory database, with the platform's image provider stood in
 * for. What the provider does to an image is covered by `apps/server`'s spec, which runs the real
 * one; this one runs under both suites.
 */

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

let realProvider: ImageProvider;
let counter = 0;

beforeEach(() => {
    realProvider = getImageProvider();
});

afterEach(() => {
    initImageProvider(realProvider);
    protectedSessionService.resetDataKey();
    vi.restoreAllMocks();
});

/** Installs a provider that halves every image into a JPEG, overridden where a test says. */
function installProvider(overrides: Partial<ImageProvider> = {}) {
    initImageProvider({
        ...realProvider,
        compressionConcurrency: () => 32,
        planCompression: async () => ({ decodeCost: 1 }),
        compressImage: async (buffer) => ({
            compressed: true,
            buffer: buffer.slice(0, Math.ceil(buffer.byteLength / 2)),
            format: { ext: "jpg", mime: "image/jpeg" }
        }),
        ...overrides
    });
}

function createNote({ type = "text", isProtected = false }: { type?: NoteType; isProtected?: boolean } = {}) {
    counter++;

    return getContext().init(() => notesService.createNewNote({
        parentNoteId: "root",
        title: `image-compression-spec-${counter}`,
        content: "",
        type,
        isProtected
    })).note.noteId;
}

/** An image attachment holding bytes no other test shares, so its blob is its own. */
function addImage(noteId: string, title = `picture-${++counter}.png`) {
    const content = encodeUtf8(`image bytes ${counter} ${title} ${"x".repeat(64)}`);

    return getContext().init(() => getSql().transactional(() => becca.getNoteOrThrow(noteId)
        .saveAttachment({ role: "image", mime: "image/png", title, content }).attachmentId ?? ""));
}

function pointAttachmentAt(attachmentId: string, blobId: string) {
    getSql().execute("UPDATE attachments SET blobId = ? WHERE attachmentId = ?", [ blobId, attachmentId ]);
}

function compress(noteId: string): Promise<ImageCompressionResponse> {
    return getContext().init(() => compressNoteImages(noteId));
}

describe("image compression run", () => {
    it("reads a protected image in full, there being no header to peek at in its ciphertext", async () => {
        protectedSessionService.setDataKey(PROTECTED_KEY);
        const noteId = createNote({ isProtected: true });
        const attachmentId = addImage(noteId);
        const read: number[] = [];
        installProvider({
            compressImage: async (buffer) => {
                read.push(buffer.byteLength);
                return { compressed: false, reason: "no-gain" };
            }
        });

        const response = await compress(noteId);

        // The plaintext reached the provider, not the stored ciphertext.
        expect(read).toEqual([ becca.getAttachmentOrThrow(attachmentId).getContent().length ]);
        expect(response.items).toEqual([ expect.objectContaining({
            entityId: attachmentId, compressed: false, skipReason: "no-gain", originalSize: read[0]
        }) ]);
    });

    it("weighs a generated picture it leaves alone, reading it in full where it cannot peek", async () => {
        protectedSessionService.setDataKey(PROTECTED_KEY);
        const noteId = createNote({ type: "canvas", isProtected: true });
        const attachmentId = addImage(noteId, getImageAttachmentTitle("canvas"));
        installProvider();

        const response = await compress(noteId);

        expect(response.items).toEqual([ expect.objectContaining({
            entityId: attachmentId,
            skipReason: "generated",
            originalSize: becca.getAttachmentOrThrow(attachmentId).getContent().length
        }) ]);
    });

    it("skips an attachment that is protected with no session open", async () => {
        const noteId = createNote();
        const attachmentId = addImage(noteId);
        getSql().execute("UPDATE attachments SET isProtected = 1 WHERE attachmentId = ?", [ attachmentId ]);
        installProvider();

        expect((await compress(noteId)).items).toEqual([ expect.objectContaining({
            entityId: attachmentId, compressed: false, skipReason: "protected", originalSize: 0
        }) ]);
    });

    it("peeks nothing where the blob is missing, holds nothing, or is not named", () => {
        const noteId = createNote();
        const [ missing, empty ] = [ addImage(noteId), addImage(noteId) ];
        pointAttachmentAt(missing, "missingBlobOfTheSpec");
        getSql().execute(
            "INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES (?, NULL, '', '')",
            [ `nullBlob${counter}` ]);
        pointAttachmentAt(empty, `nullBlob${counter}`);

        const targets = collectNoteTargets(becca.getNoteOrThrow(noteId), false);
        expect(targets.map((target) => target.peek())).toEqual([ null, null ]);

        const imageNoteId = createNote({ type: "image" });
        const imageNote = becca.getNoteOrThrow(imageNoteId);
        const [ imageTarget ] = collectNoteTargets(imageNote, false);
        const blobId = imageNote.blobId;
        imageNote.blobId = undefined;
        try {
            expect(imageTarget.peek()).toBeNull();
        } finally {
            imageNote.blobId = blobId;
        }
    });

    it("reports an image it could not read as an error of no size, and carries on", async () => {
        const noteId = createNote();
        const unreadable = addImage(noteId);
        const readable = addImage(noteId);
        pointAttachmentAt(unreadable, "missingBlobOfTheSpec");
        const error = vi.spyOn(getLog(), "error");
        // Thrown as something other than an Error, which is logged as it is.
        installProvider({ planCompression: () => Promise.reject("planner unavailable") });

        const response = await compress(noteId);

        expect(response.items).toEqual([
            expect.objectContaining({ entityId: unreadable, skipReason: "error", originalSize: 0 }),
            expect.objectContaining({ entityId: readable, compressed: true })
        ]);
        expect(error).toHaveBeenCalledWith(expect.stringContaining(": planner unavailable"));
    });

    it("reports a write that throws as that image's error, committing the others", async () => {
        const noteId = createNote();
        const failing = addImage(noteId);
        const kept = addImage(noteId);
        const setContent = BAttachment.prototype.setContent;
        const attempted: BAttachment[] = [];
        vi.spyOn(BAttachment.prototype, "setContent").mockImplementation(function (this: BAttachment, ...args) {
            if (this.attachmentId === failing) {
                attempted.push(this);
                throw new Error("disk full");
            }
            return setContent.apply(this, args);
        });
        installProvider();

        const response = await compress(noteId);

        expect(response.items).toEqual([
            expect.objectContaining({ entityId: failing, compressed: false, skipReason: "error" }),
            expect.objectContaining({ entityId: kept, compressed: true })
        ]);
        expect(becca.getAttachmentOrThrow(failing).mime).toBe("image/png");
        // `writeImage()` puts the mime of the copy it wrote through back as it was.
        expect(attempted.map((attachment) => attachment.mime)).toEqual([ "image/png" ]);
        expect(becca.getAttachmentOrThrow(kept).mime).toBe("image/jpeg");
    });

    it("answers every image of a batch whose transaction fails, rather than leaving them waiting", async () => {
        const noteId = createNote();
        const attachmentId = addImage(noteId);
        const error = vi.spyOn(getLog(), "error");
        installProvider({
            compressImage: async (buffer) => {
                // The next transaction is the flush of the write this image is about to queue.
                vi.spyOn(getSql(), "transactional").mockImplementationOnce(() => {
                    throw new Error("database is locked");
                });
                return { compressed: true, buffer: buffer.slice(0, 1), format: { ext: "jpg", mime: "image/jpeg" } };
            }
        });

        const response = await compress(noteId);

        expect(response.items).toEqual([
            expect.objectContaining({ entityId: attachmentId, compressed: false, skipReason: "error" })
        ]);
        expect(error).toHaveBeenCalledWith(expect.stringMatching(/a batch of 1 writes failed: .*database is locked/));
        expect(becca.getAttachmentOrThrow(attachmentId).mime).toBe("image/png");
    });

    it("commits a full batch of writes at once, without waiting out the timer", async () => {
        const noteId = createNote();
        const attachments = Array.from({ length: 25 }, () => addImage(noteId));
        installProvider();
        // With the batch timer never firing, only a full batch can commit and let the run finish.
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });

        let response: ImageCompressionResponse;
        try {
            response = await compress(noteId);
        } finally {
            vi.useRealTimers();
        }

        expect(response.compressedCount).toBe(25);
        expect(attachments.map((id) => becca.getAttachmentOrThrow(id).mime)).toEqual(Array(25).fill("image/jpeg"));
    });

    it("compresses one attachment on its own", async () => {
        const noteId = createNote();
        const attachmentId = addImage(noteId);
        installProvider();

        const response = await getContext().init(() => compressAttachmentImage(attachmentId));

        expect(response.items).toEqual([ expect.objectContaining({ entityId: attachmentId, compressed: true }) ]);
    });
});
