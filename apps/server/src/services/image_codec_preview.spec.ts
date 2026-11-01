import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { resizePreviewImage } from "./image_codec.js";

const REQUEST = { maxEdge: 256, jpegQuality: 75 };

async function png(width: number, height: number, color = 0xff0000ff) {
    return new Uint8Array(await new Jimp({ width, height, color }).getBuffer("image/png"));
}

async function decoded(bytes: Uint8Array) {
    return await Jimp.fromBuffer(Buffer.from(bytes));
}

describe("resizePreviewImage", () => {
    it("scales a large picture down to the longest edge asked for, keeping its proportions", async () => {
        const result = await resizePreviewImage(await png(1000, 500), REQUEST);

        expect(result.resized).toBe(true);
        if (!result.resized) return;

        const image = await decoded(result.bytes);
        expect(image.bitmap.width).toBe(256);
        expect(image.bitmap.height).toBe(128);
    });

    it("leaves a picture already smaller than the ceiling at the size it came", async () => {
        const result = await resizePreviewImage(await png(64, 48), REQUEST);

        expect(result.resized).toBe(true);
        if (!result.resized) return;

        const image = await decoded(result.bytes);
        expect(image.bitmap.width).toBe(64);
        expect(image.bitmap.height).toBe(48);
    });

    /**
     * The choice of encoding is by what the pixels actually are, not by what the format allows: a
     * PNG with nothing transparent in it is several times smaller as a JPEG, and a card thumbnail
     * is not where that saving should be passed up.
     */
    it("re-encodes an opaque picture to JPEG and a transparent one to PNG", async () => {
        const opaque = await resizePreviewImage(await png(300, 300, 0x336699ff), REQUEST);
        const transparent = await resizePreviewImage(await png(300, 300, 0x33669900), REQUEST);

        expect(opaque.resized && (await decoded(opaque.bytes)).mime).toBe("image/jpeg");
        expect(transparent.resized && (await decoded(transparent.bytes)).mime).toBe("image/png");
    });

    it("says so rather than throwing when the bytes are not a picture it can read", async () => {
        // An error page served where a picture should have been — the case this has to survive.
        const html = new TextEncoder().encode("<!doctype html><title>404</title>");

        await expect(resizePreviewImage(html, REQUEST)).resolves.toEqual({
            resized: false,
            reason: "undecodable"
        });
    });

    it("passes the reason to the log it was given, and manages without one", async () => {
        const lines: string[] = [];
        await resizePreviewImage(new Uint8Array([ 1, 2, 3 ]), REQUEST, (message) => lines.push(message));

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/Could not decode a link preview image/);
        // The address never appears: a pasted link can carry a one-time token in its query.
        expect(lines[0]).not.toMatch(/http/);

        await expect(resizePreviewImage(new Uint8Array([ 1, 2, 3 ]), REQUEST)).resolves.toMatchObject({
            resized: false
        });
    });
});
