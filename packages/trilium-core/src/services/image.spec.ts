import { afterEach, describe, expect, it, vi } from "vitest";

import { getBecca } from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import imageService from "./image.js";
import { getImageProvider } from "./image_provider.js";
import type { ProcessedImage } from "./image_provider.js";
import protectedSessionService from "./protected_session.js";

/**
 * `image.ts` runs against the real in-memory fixture DB booted by the server
 * spec setup. The image *processing* itself (compression / format detection)
 * is delegated to the platform `ImageProvider` and happens asynchronously in a
 * fire-and-forget `.then()`. To make those async branches deterministic we spy
 * on `getImageProvider().processImage` and resolve it with a controlled
 * `ProcessedImage`, then flush microtasks before asserting on the persisted
 * note / attachment.
 */

let counter = 0;

const fakeBuffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

/**
 * Replaces the provider's processImage with one that resolves to the given
 * processed image, so the async persistence branch runs deterministically.
 */
function stubProcessImage(format: { ext: string }, buffer: Uint8Array = fakeBuffer) {
    const processed: ProcessedImage = {
        buffer,
        format: { ext: format.ext, mime: `image/${format.ext}` }
    };
    return vi.spyOn(getImageProvider(), "processImage").mockResolvedValue(processed);
}

/** Allow the fire-and-forget `.then()` chain (two awaited ticks) to settle. */
async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** `getContent()` returns a Node Buffer; compare the raw bytes regardless of wrapper. */
function bytesOf(content: string | Uint8Array): number[] {
    return Array.from(typeof content === "string" ? Buffer.from(content) : content);
}

describe("image service (real DB)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("saveImage", () => {
        it("creates an image note under the parent and returns the upload metadata synchronously", () => {
            counter++;
            const originalName = `pic ${counter}.png`;
            const result = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, originalName, false)
            );

            expect(result.noteId).toBeTruthy();
            expect(result.fileName).toBe(originalName);
            // The URL embeds the (URL-encoded) sanitized file name.
            expect(result.url).toBe(
                `api/images/${result.noteId}/${encodeURIComponent(result.fileName)}`
            );

            const note = getBecca().getNote(result.noteId);
            expect(note).not.toBeNull();
            expect(note!.type).toBe("image");
            // The original (unsanitized-for-filename) name is recorded as a label.
            expect(note!.getOwnedLabelValue("originalFileName")).toBe(originalName);
            // It is placed under the requested parent.
            expect(note!.getParentNotes().some((p) => p.noteId === "root")).toBe(true);
        });

        it("trims an over-long file name to 'image' only when trimFilename is set", () => {
            const longName = "a".repeat(45) + ".png";

            const trimmed = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, longName, false, true)
            );
            expect(trimmed.fileName).toBe("image");
            expect(getBecca().getNote(trimmed.noteId)!.getOwnedLabelValue("originalFileName")).toBe("image");

            const untrimmed = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, longName, false, false)
            );
            expect(untrimmed.fileName).toBe(longName);
        });

        it("throws when the parent note does not exist", () => {
            expect(() =>
                getContext().init(() =>
                    imageService.saveImage("missingParent123", fakeBuffer, "x.png", false)
                )
            ).toThrow("Unable to find parent note.");
        });

        it("persists the detected mime and content once the async processing resolves", async () => {
            stubProcessImage({ ext: "png" });
            counter++;

            const result = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, `async-${counter}.png`, true)
            );
            await flushAsync();

            const note = getBecca().getNote(result.noteId)!;
            expect(note.mime).toBe("image/png");
            expect(bytesOf(note.getContent())).toEqual(Array.from(fakeBuffer));
        });

        it("maps the svg extension to the svg+xml mime and appends the extension when missing", async () => {
            stubProcessImage({ ext: "svg" });
            counter++;
            const baseName = `nodotsvg${counter}`;

            const result = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, baseName, true)
            );
            await flushAsync();

            const note = getBecca().getNote(result.noteId)!;
            expect(note.mime).toBe("image/svg+xml");
            // The name had no extension, so the detected one is appended to the label and title.
            expect(note.getOwnedLabelValue("originalFileName")).toBe(`${baseName}.svg`);
            expect(note.title).toBe(`${baseName}.svg`);
        });
    });

    describe("saveImageToAttachment", () => {
        /** Reuse saveImage to obtain a real, persisted note to attach to. */
        function createTargetNote(): BNote {
            counter++;
            const { noteId } = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, `host-${counter}.png`, false)
            );
            return getBecca().getNote(noteId)!;
        }

        it("creates an image attachment on the note and returns its title synchronously", () => {
            const host = createTargetNote();

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "att.png", false)
            );

            expect(att.attachmentId).toBeTruthy();
            expect(att.title).toBe("att.png");

            const attachment = getBecca().getAttachment(att.attachmentId!);
            expect(attachment).not.toBeNull();
            expect(attachment!.role).toBe("image");
            expect(attachment!.ownerId).toBe(host.noteId);
        });

        it("throws when the owner note does not exist", () => {
            expect(() =>
                getContext().init(() =>
                    imageService.saveImageToAttachment("missingNote123", fakeBuffer, "x.png", false)
                )
            ).toThrow();
        });

        it("updates the attachment mime/content and appends a missing extension asynchronously", async () => {
            const host = createTargetNote();
            stubProcessImage({ ext: "jpg" });

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "nodotattach", false)
            );
            await flushAsync();

            const attachment = getBecca().getAttachment(att.attachmentId!)!;
            expect(attachment.mime).toBe("image/jpg");
            expect(attachment.title).toBe("nodotattach.jpg");
            expect(bytesOf(attachment.getContent())).toEqual(Array.from(fakeBuffer));
        });
    });

    describe("updateImage", () => {
        it("throws when the note does not exist", () => {
            expect(() =>
                getContext().init(() =>
                    imageService.updateImage("missingNote456", fakeBuffer, "x.png")
                )
            ).toThrow("Unable to find note.");
        });

        it("saves a revision, sets the originalFileName label, and updates mime/content on resolve", async () => {
            // The persisted content is the provider's *processed* output. Drive the
            // initial saveImage with a PNG so the note settles into a known state we
            // can later prove updateImage moves away from.
            const createdBuffer = new Uint8Array([1, 2, 3]);
            stubProcessImage({ ext: "png" }, createdBuffer);

            // Start from a freshly created image note we can mutate.
            counter++;
            const { noteId } = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, `update-${counter}.png`, false)
            );
            await flushAsync();

            // Sanity-check the pre-update state so the post-update assertions below
            // genuinely discriminate updateImage's effect (and aren't already true).
            const beforeUpdate = getBecca().getNote(noteId)!;
            expect(beforeUpdate.mime).toBe("image/png");
            expect(bytesOf(beforeUpdate.getContent())).toEqual(Array.from(createdBuffer));

            // Re-point the provider so updateImage resolves to a DIFFERENT mime and
            // buffer than saveImage left behind; otherwise the assertions would pass
            // on the saveImage state regardless of whether updateImage ran.
            const updatedBuffer = new Uint8Array([9, 8, 7, 6]);
            stubProcessImage({ ext: "jpg" }, updatedBuffer);

            const revisionSpy = vi.spyOn(getBecca().getNote(noteId)!, "saveRevision");

            getContext().init(() => imageService.updateImage(noteId, fakeBuffer, "renamed.png"));
            await flushAsync();

            const note = getBecca().getNote(noteId)!;
            expect(revisionSpy).toHaveBeenCalledTimes(1);
            expect(note.getOwnedLabelValue("originalFileName")).toBe("renamed.png");
            // Mime/content now reflect updateImage's distinct provider output, which
            // differs from the PNG/[1,2,3] state saveImage produced.
            expect(note.mime).toBe("image/jpg");
            expect(bytesOf(note.getContent())).toEqual(Array.from(updatedBuffer));
        });
    });

    describe("protected note handling in saveImage", () => {
        it("creates a protected image note only when a protected session is available", async () => {
            // The child inherits protection only via
            // `parentNote.isProtected && isProtectedSessionAvailable()`, so the
            // parent MUST be protected for the session flag to matter at all.
            const root = getBecca().getNote("root")!;
            const originalRootProtected = root.isProtected;
            root.isProtected = true;

            // Keep async image processing deterministic; saving a protected note's
            // content requires encryption, so return a fake ciphertext instead of
            // standing up a real protected session/data key.
            stubProcessImage({ ext: "png" });
            vi.spyOn(protectedSessionService, "encrypt").mockReturnValue("fake-ciphertext");

            const sessionSpy = vi.spyOn(protectedSessionService, "isProtectedSessionAvailable");

            try {
                // Session available -> protected parent yields a protected child.
                sessionSpy.mockReturnValue(true);
                counter++;
                const whenAvailable = getContext().init(() =>
                    imageService.saveImage("root", fakeBuffer, `prot-on-${counter}.png`, false)
                );
                expect(getBecca().getNote(whenAvailable.noteId)!.isProtected).toBe(true);
                // Let the protected note's fire-and-forget content save settle while
                // the session is still "available", so its encryption branch doesn't
                // run after we flip the mock below.
                await flushAsync();

                // Session unavailable -> even a protected parent yields an
                // unprotected child, proving the result tracks the session mock.
                sessionSpy.mockReturnValue(false);
                counter++;
                const whenUnavailable = getContext().init(() =>
                    imageService.saveImage("root", fakeBuffer, `prot-off-${counter}.png`, false)
                );
                expect(getBecca().getNote(whenUnavailable.noteId)!.isProtected).toBe(false);
                await flushAsync();
            } finally {
                // Restore the shared fixture's root so sibling tests still attach
                // under an unprotected parent.
                root.isProtected = originalRootProtected;
            }
        });
    });
});
