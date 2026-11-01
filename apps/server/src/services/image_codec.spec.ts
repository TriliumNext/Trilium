import { inspectImage } from "@triliumnext/core/src/services/image_inspect.js";
import type { ImageCompressionRequest, ImageFormat } from "@triliumnext/core/src/services/image_provider.js";
import { Jimp } from "jimp";
import * as UPNG from "upng-js";
import { beforeAll, describe, expect, it } from "vitest";

import { compressImageBytes, planFromBytes } from "./image_codec.js";

/**
 * The header-level planning on real encoder output: what an image's own bytes say about whether
 * the work has already been done to it. The full pipeline around this is covered by
 * `image_compression.spec.ts`; what is asserted here is the reasoning itself, on the exact
 * artifacts the tool writes.
 */
const JPEG_FORMAT: ImageFormat = { ext: "jpg", mime: "image/jpeg" };
const PNG_FORMAT: ImageFormat = { ext: "png", mime: "image/png" };

function request(overrides: Partial<ImageCompressionRequest> = {}): ImageCompressionRequest {
    return {
        resize: true,
        maxWidthHeight: 2000,
        jpegHandling: "compress",
        pngHandling: "optimize",
        quality: 75,
        conversionQuality: 85,
        ...overrides
    };
}

/** The same picture at two qualities, straddling the default target. */
let jpegAt60: Uint8Array;
let jpegAt95: Uint8Array;
/** A palette PNG — what quantizing produces — and the truecolour original it came from. */
let indexedPng: Uint8Array;
let truecolorPng: Uint8Array;

beforeAll(async () => {
    // Smooth, spatially correlated colour, so the encoders behave as they do on real pictures.
    const photo = new Jimp({ width: 200, height: 150 });
    const { data, width } = photo.bitmap;

    for (let index = 0; index < data.length; index += 4) {
        const x = (index / 4) % width;
        const y = Math.floor(index / 4 / width);

        data[index] = x % 256;
        data[index + 1] = y % 256;
        data[index + 2] = (x + y) % 256;
        data[index + 3] = 255;
    }

    jpegAt60 = new Uint8Array(await photo.getBuffer("image/jpeg", { quality: 60 }));
    jpegAt95 = new Uint8Array(await photo.getBuffer("image/jpeg", { quality: 95 }));
    truecolorPng = new Uint8Array(await photo.getBuffer("image/png"));

    const rgba = new Uint8Array(64 * 64 * 4);

    for (let index = 0; index < rgba.length; index += 4) {
        rgba[index] = (index / 4) % 8 * 32;
        rgba[index + 3] = 255;
    }

    indexedPng = new Uint8Array(UPNG.encode([ rgba.buffer ], 64, 64, 256));
});

describe("settling an already-compressed image from its header", () => {
    it("leaves a JPEG stored at or below the target quality alone, and only such a JPEG", () => {
        expect(planFromBytes(JPEG_FORMAT, jpegAt60, request())).toEqual({ verdict: "skip", reason: "no-gain" });
        // Above the target, re-encoding still buys something.
        expect(planFromBytes(JPEG_FORMAT, jpegAt95, request()).verdict).toBe("proceed");
        // The same image is above a lower target.
        expect(planFromBytes(JPEG_FORMAT, jpegAt60, request({ quality: 50 })).verdict).toBe("proceed");
        // A resize still owed overrides the quality reading entirely.
        expect(planFromBytes(JPEG_FORMAT, jpegAt60, request({ maxWidthHeight: 100 })).verdict).toBe("proceed");
    });

    it("leaves an already-palettized PNG alone, except where it could still become a JPEG", () => {
        // The premise the fixture rests on, asserted so an encoder change cannot quietly void it.
        expect(inspectImage(indexedPng).indexed).toBe(true);

        expect(planFromBytes(PNG_FORMAT, indexedPng, request())).toEqual({ verdict: "skip", reason: "no-gain" });
        // Conversion can still gain on an indexed source, and a resize still owed always proceeds.
        expect(planFromBytes(PNG_FORMAT, indexedPng, request({ pngHandling: "jpeg" })).verdict).toBe("proceed");
        expect(planFromBytes(PNG_FORMAT, indexedPng, request({ maxWidthHeight: 32 })).verdict).toBe("proceed");
        // The truecolour original has its quantization still ahead of it.
        expect(planFromBytes(PNG_FORMAT, truecolorPng, request()).verdict).toBe("proceed");
    });

    it("skips on a second pass exactly what the first pass wrote, making runs idempotent", async () => {
        const reencodedJpeg = await compressImageBytes(jpegAt95, request());
        const quantizedPng = await compressImageBytes(truecolorPng, request());

        if (!reencodedJpeg.compressed || !quantizedPng.compressed) {
            throw new Error("expected the first pass to compress both fixtures");
        }

        // Without this, every run re-encoded its own output: the result lands a few bytes
        // smaller each time, so the size guard never stops it, and quality erodes run by run.
        expect(planFromBytes(JPEG_FORMAT, reencodedJpeg.buffer, request())).toEqual({ verdict: "skip", reason: "no-gain" });
        expect(planFromBytes(PNG_FORMAT, quantizedPng.buffer, request())).toEqual({ verdict: "skip", reason: "no-gain" });
    });
});
