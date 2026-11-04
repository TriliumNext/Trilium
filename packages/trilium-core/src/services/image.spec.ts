import { afterEach, describe, expect, it, vi } from "vitest";

import { imageMimeForExtension } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import imageService from "./image.js";
import { getImageProvider } from "./image_provider.js";
import type { ProcessedImage } from "./image_provider.js";
import noteService from "./notes.js";
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
function stubProcessImage(format: { ext: string; mime?: string }, buffer: Uint8Array = fakeBuffer) {
    const processed: ProcessedImage = {
        // A real provider reports both halves and they agree — `{ ext: "jpg", mime: "image/jpeg" }`
        // is what the codec hands back. Deriving the default the same way keeps a stub from
        // describing an image no provider would ever produce.
        buffer,
        format: { ext: format.ext, mime: format.mime ?? imageMimeForExtension(format.ext) }
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

            const note = becca.getNote(result.noteId);
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
            expect(becca.getNote(trimmed.noteId)!.getOwnedLabelValue("originalFileName")).toBe("image");

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

            const note = becca.getNote(result.noteId)!;
            expect(note.mime).toBe("image/png");
            expect(bytesOf(note.getContent())).toEqual(Array.from(fakeBuffer));
        });

        it("stores the svg+xml mime whole and appends the extension when the name has none", async () => {
            stubProcessImage({ ext: "svg" });
            counter++;
            const baseName = `nodotsvg${counter}`;

            const result = getContext().init(() =>
                imageService.saveImage("root", fakeBuffer, baseName, true)
            );
            await flushAsync();

            const note = becca.getNote(result.noteId)!;
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
            return becca.getNote(noteId)!;
        }

        it("creates an image attachment on the note and returns its title synchronously", () => {
            const host = createTargetNote();

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "att.png", false)
            );

            expect(att.attachmentId).toBeTruthy();
            expect(att.title).toBe("att.png");

            const attachment = becca.getAttachment(att.attachmentId!);
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

        it("reuses a deduplicated role's attachment of the same title rather than storing it twice", () => {
            // A note that links a site many times, or pastes one URL twice, would otherwise carry a
            // copy of that site's icon and that page's cover for every use.
            const host = createTargetNote();
            const store = (title: string, role: "favicon" | "coverImage") =>
                getContext().init(() => imageService.saveImageToAttachment(host.noteId, fakeBuffer, title, false, false, role));

            const first = store("example.com.ico", "favicon");
            const again = store("example.com.ico", "favicon");
            const otherSite = store("other.example.ico", "favicon");
            const cover = store("example.com-page-1a2b3c4d.jpeg", "coverImage");

            expect(again.attachmentId).toBe(first.attachmentId);
            // A different site, and a different kind of picture, are different things.
            expect(otherSite.attachmentId).not.toBe(first.attachmentId);
            expect(cover.attachmentId).not.toBe(first.attachmentId);
        });

        it("stores the user's own images separately however they are named", () => {
            // Two pictures the user gave one name are two pictures; collapsing them would lose one.
            const host = createTargetNote();
            const store = () =>
                getContext().init(() => imageService.saveImageToAttachment(host.noteId, fakeBuffer, "photo.png", false));

            expect(store().attachmentId).not.toBe(store().attachmentId);
        });

        it("keeps a long title whole for a deduplicated role, that being what identifies it", () => {
            // Ordinary uploads collapse a title past 40 characters to "image"; doing that here
            // would make every hostname past the limit share one icon.
            const host = createTargetNote();
            const longHost = `${"a-very-long-subdomain".repeat(3)}.example.com.ico`;

            const stored = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, longHost, false, true, "favicon"));

            expect(stored.title).toBe(longHost);
        });

        it("post-processes the note five seconds later, and lets it go quietly once deleted", () => {
            const postProcessSpy = vi.spyOn(noteService, "asyncPostProcessContent").mockResolvedValue(undefined);
            stubProcessImage({ ext: "png" });
            vi.useFakeTimers();

            try {
                const survivor = createTargetNote();
                getContext().init(() =>
                    imageService.saveImageToAttachment(survivor.noteId, fakeBuffer, "kept.png", false)
                );

                const doomed = createTargetNote();
                getContext().init(() =>
                    imageService.saveImageToAttachment(doomed.noteId, fakeBuffer, "raced.png", false)
                );
                // The window is wide enough to lose the note to a delete — the user's own, or one
                // arriving over sync — which is what made this a routine crash rather than a rare one.
                getContext().init(() => doomed.deleteNote());

                expect(() => vi.advanceTimersByTime(5000)).not.toThrow();

                // The surviving note is still post-processed, so the guard skips the deleted note only.
                expect(postProcessSpy).toHaveBeenCalledTimes(1);
                expect(postProcessSpy.mock.calls[0][0].noteId).toBe(survivor.noteId);
            } finally {
                vi.useRealTimers();
            }
        });

        it("drops the processed image when its attachment no longer exists", async () => {
            const host = createTargetNote();
            let resolveProcessing: ((processed: ProcessedImage) => void) | undefined;
            vi.spyOn(getImageProvider(), "processImage").mockReturnValue(
                new Promise<ProcessedImage>((resolve) => { resolveProcessing = resolve; })
            );

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "outlived.png", false)
            );

            // Nothing awaits the processing chain, so a throw inside it never reaches an assertion — it
            // escapes as an unhandled rejection, which Node promotes to the same fatal uncaught
            // exception. Watch for it directly, or this test would pass with the guard removed.
            const rejections: unknown[] = [];
            const captureRejection = (reason: unknown) => rejections.push(reason);
            process.on("unhandledRejection", captureRejection);

            try {
                // Deleting the note marks its attachments deleted, so the in-flight processing resolves
                // with nowhere to write its result.
                getContext().init(() => host.deleteNote());
                resolveProcessing?.({ buffer: fakeBuffer, format: { ext: "png", mime: "image/png" } });
                await flushAsync();
            } finally {
                process.off("unhandledRejection", captureRejection);
            }

            // The attachment really is gone, so the guard — not a lucky lookup — is what was exercised.
            expect(becca.getAttachment(att.attachmentId ?? "")).toBeFalsy();
            expect(rejections).toEqual([]);
        });

        it("updates the attachment mime/content and appends a missing extension asynchronously", async () => {
            const host = createTargetNote();
            stubProcessImage({ ext: "jpg" });

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "nodotattach", false)
            );
            await flushAsync();

            const attachment = becca.getAttachment(att.attachmentId!)!;
            expect(attachment.mime).toBe("image/jpeg");
            expect(attachment.title).toBe("nodotattach.jpg");
            expect(bytesOf(attachment.getContent())).toEqual(Array.from(fakeBuffer));
        });

        it("records the media type the provider reported rather than rebuilding one from its extension", async () => {
            // The codec names JPEG `{ ext: "jpg", mime: "image/jpeg" }`, so the correct media
            // type is already in hand. Deriving it from the extension instead yields the
            // unregistered "image/jpg", which every consumer downstream then needs a special
            // case for — mapExtension carries one, and IMAGE_MIMES has to list it.
            const host = createTargetNote();
            stubProcessImage({ ext: "jpg", mime: "image/jpeg" });

            const att = getContext().init(() =>
                imageService.saveImageToAttachment(host.noteId, fakeBuffer, "screenshot.png", false)
            );
            await flushAsync();

            const attachment = becca.getAttachment(att.attachmentId ?? "");
            expect(attachment?.mime).toBe("image/jpeg");
            // The title is left alone on purpose (a canvas addresses its images by it), which is
            // precisely why the mime has to be right — it is all the export has left to go on.
            expect(attachment?.title).toBe("screenshot.png");
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
            const beforeUpdate = becca.getNote(noteId)!;
            expect(beforeUpdate.mime).toBe("image/png");
            expect(bytesOf(beforeUpdate.getContent())).toEqual(Array.from(createdBuffer));

            // Re-point the provider so updateImage resolves to a DIFFERENT mime and
            // buffer than saveImage left behind; otherwise the assertions would pass
            // on the saveImage state regardless of whether updateImage ran.
            const updatedBuffer = new Uint8Array([9, 8, 7, 6]);
            stubProcessImage({ ext: "jpg" }, updatedBuffer);

            const revisionSpy = vi.spyOn(becca.getNote(noteId)!, "saveRevision");

            getContext().init(() => imageService.updateImage(noteId, fakeBuffer, "renamed.png"));
            await flushAsync();

            const note = becca.getNote(noteId)!;
            expect(revisionSpy).toHaveBeenCalledTimes(1);
            expect(note.getOwnedLabelValue("originalFileName")).toBe("renamed.png");
            // Mime/content now reflect updateImage's distinct provider output, which
            // differs from the PNG/[1,2,3] state saveImage produced.
            expect(note.mime).toBe("image/jpeg");
            expect(bytesOf(note.getContent())).toEqual(Array.from(updatedBuffer));
        });
    });

    describe("protected note handling in saveImage", () => {
        it("creates a protected image note only when a protected session is available", async () => {
            // The child inherits protection only via
            // `parentNote.isProtected && isProtectedSessionAvailable()`, so the
            // parent MUST be protected for the session flag to matter at all.
            const root = becca.getNote("root")!;
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
                expect(becca.getNote(whenAvailable.noteId)!.isProtected).toBe(true);
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
                expect(becca.getNote(whenUnavailable.noteId)!.isProtected).toBe(false);
                await flushAsync();
            } finally {
                // Restore the shared fixture's root so sibling tests still attach
                // under an unprotected parent.
                root.isProtected = originalRootProtected;
            }
        });
    });
});
