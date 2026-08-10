import type { ImageInfoResponse } from "@triliumnext/commons";
import { becca, cls, getSql } from "@triliumnext/core";
import { createTextNote } from "@triliumnext/core/src/test/api_fixtures.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Drives the single-image info endpoints against real notes and attachments holding real bytes, so
 * every figure is read off an actual header rather than one the test arranged.
 */
let api: CoreApiTester;

let png: Uint8Array;
let jpeg: Uint8Array;
let transparentPng: Uint8Array;
const gif = Uint8Array.from(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
);

beforeAll(async () => {
    api = CoreApiTester.build();
    png = await paint(320, 240, "image/png", 0xff);
    jpeg = await paint(320, 240, "image/jpeg", 0xff);
    transparentPng = await paint(64, 48, "image/png", 0x80);
}, 60000);

async function paint(width: number, height: number, mime: "image/png" | "image/jpeg", alpha: number): Promise<Uint8Array> {
    const image = new Jimp({ width, height, color: (0x3366cc00 | alpha) >>> 0 });
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const r = Math.round(128 + 127 * Math.sin(x / 20));
            const g = Math.round(128 + 127 * Math.sin(y / 15));
            image.setPixelColor((((r << 24) | (g << 16) | (0x80 << 8) | alpha) >>> 0), x, y);
        }
    }

    // Each format is asked for by name rather than through the parameter: the encoder derives its
    // options from the mime, so a union of the two resolves to no options at all — and quality is a
    // JPEG setting, which a PNG has no use for.
    return new Uint8Array(mime === "image/jpeg"
        ? await image.getBuffer("image/jpeg", { quality: 60 })
        : await image.getBuffer("image/png"));
}

const noteInfo = (noteId: string) => api.get<ImageInfoResponse>(`/api/notes/${noteId}/image-info`);
const attachmentInfo = (attachmentId: string) =>
    api.get<ImageInfoResponse>(`/api/attachments/${attachmentId}/image-info`);

describe("image info (GET /api/notes/:noteId/image-info)", () => {
    it("404s for a note that does not exist", async () => {
        expect((await noteInfo("missingNote123")).status).toBe(404);
    });

    it("400s for a note that is not an image", async () => {
        const { noteId } = await createTextNote(api);

        expect((await noteInfo(noteId)).status).toBe(400);
    });

    it("describes a PNG down to how its pixels are stored", async () => {
        const noteId = await createImageNote(png, "image/png");

        const res = await noteInfo(noteId);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            entityType: "note",
            entityId: noteId,
            mime: "image/png",
            format: "png",
            detectedMime: "image/png",
            size: png.byteLength,
            width: 320,
            height: 240,
            bitDepth: 8,
            channels: 4,
            hasAlpha: true,
            indexed: false,
            // Nothing but a JPEG carries the tables a quality is read from.
            quality: null,
            compressible: true
        });
    });

    it("describes a JPEG, quality included", async () => {
        const noteId = await createImageNote(jpeg, "image/jpeg");

        const res = await noteInfo(noteId);

        expect(res.body).toMatchObject({
            format: "jpg",
            detectedMime: "image/jpeg",
            width: 320,
            height: 240,
            bitDepth: 8,
            // Three components, and never an alpha channel whatever the source had.
            channels: 3,
            hasAlpha: false,
            indexed: false,
            compressible: true
        });
        // Read back off its own quantization tables, so it lands on what it was written at.
        expect(Math.abs((res.body.quality ?? 0) - 60)).toBeLessThanOrEqual(5);
    });

    it("reads the bytes rather than trusting the mime it is filed under", async () => {
        // A PNG stored under the wrong mime: both are reported, so the disagreement is visible.
        const noteId = await createImageNote(png, "image/jpeg");

        const res = await noteInfo(noteId);

        expect(res.body.mime).toBe("image/jpeg");
        expect(res.body.format).toBe("png");
        expect(res.body.detectedMime).toBe("image/png");
    });

    it("403s when the content is protected and no session is open", async () => {
        const noteId = await createImageNote(png, "image/png");
        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = true; });

        // A row of nulls would pass for an image that simply says nothing about itself.
        expect((await noteInfo(noteId)).status).toBe(403);

        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = false; });
    });
});

describe("image info (GET /api/attachments/:attachmentId/image-info)", () => {
    it("404s for an attachment that does not exist", async () => {
        expect((await attachmentInfo("missingAtt123")).status).toBe(404);
    });

    it("400s for an attachment that is not an image", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2 ]), "text/plain", "file");

        expect((await attachmentInfo(attachmentId)).status).toBe(400);
    });

    it("describes an attachment exactly as it describes a note's own image", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "shot.png", transparentPng);

        const res = await attachmentInfo(attachmentId);

        expect(res.body).toMatchObject({
            entityType: "attachment",
            entityId: attachmentId,
            title: "shot.png",
            format: "png",
            width: 64,
            height: 48,
            hasAlpha: true,
            compressible: true
        });
    });

    it("says what it can about a format nothing can compress, and no more", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "a.gif", gif, "image/gif");

        const res = await attachmentInfo(attachmentId);

        expect(res.body).toMatchObject({
            format: "gif",
            size: gif.byteLength,
            width: 1,
            height: 1,
            // The header states a size and nothing else this has a use for.
            bitDepth: null,
            channels: null,
            quality: null,
            compressible: false
        });
    });

    it("reports an unreadable file as unknown rather than refusing to answer", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "broken.png", new Uint8Array([ 1, 2, 3, 4 ]), "image/png");

        const res = await attachmentInfo(attachmentId);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            format: "unknown",
            detectedMime: "application/octet-stream",
            size: 4,
            width: null,
            height: null,
            compressible: false
        });
    });
});

async function createImageNote(content: Uint8Array, mime: string): Promise<string> {
    const { noteId } = await createTextNote(api);

    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = "image";
        note.mime = mime;
        note.save();
        note.setContent(content, { forceSave: true });
    }));

    return noteId;
}

async function addAttachment(
    noteId: string,
    title: string,
    content: Uint8Array,
    mime = "image/png",
    role = "image"
): Promise<string> {
    return cls.init(() => getSql().transactional(() => {
        const attachment = becca.getNoteOrThrow(noteId).saveAttachment({ role, mime, title, content }, "title");
        return attachment.attachmentId ?? "";
    }));
}
