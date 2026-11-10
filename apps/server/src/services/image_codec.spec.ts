import { inspectImage } from "@triliumnext/core/src/services/image_inspect.js";
import type { ImageCompressionRequest, ImageFormat } from "@triliumnext/core/src/services/image_provider.js";
import { estimateJpegQuality } from "@triliumnext/core/src/services/jpeg_quality.js";
import { Jimp } from "jimp";
import * as UPNG from "upng-js";
import { beforeAll, describe, expect, it } from "vitest";

import { compressImageBytes, detectSvg, planFromBytes } from "./image_codec.js";

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

/**
 * A JPEG carrying the stray `00 E1` segment some phone cameras write after JFIF. The decoder skips
 * it, but the header walks in `inspectImage` and `estimateJpegQuality` stop there, so neither the
 * dimensions nor the quality can be read off the header.
 */
function withMalformedApp1(jpeg: Uint8Array): Uint8Array {
    // SOI is two bytes, and the APP0 (JFIF) segment after it states its own length.
    const afterApp0 = 4 + ((jpeg[4] << 8) | jpeg[5]);
    const result = new Uint8Array(jpeg.byteLength + 6);
    result.set(jpeg.subarray(0, afterApp0));
    result.set([ 0x00, 0xe1, 0x00, 0x04, 0xaa, 0xbb ], afterApp0);
    result.set(jpeg.subarray(afterApp0), afterApp0 + 6);
    return result;
}

describe("a JPEG whose header cannot be read", () => {
    it("is decoded to settle its size, and left alone when it needs nothing", async () => {
        const malformed = withMalformedApp1(jpegAt95);
        // The premises: the header reveals nothing, but the bytes still decode.
        expect(inspectImage(malformed)).toMatchObject({ format: "jpg", width: null, height: null });
        expect(estimateJpegQuality(malformed)).toBeNull();

        const keepWidth = request({ jpegHandling: "keep", widthOnly: true });
        expect(planFromBytes(JPEG_FORMAT, malformed, keepWidth)).toMatchObject({
            verdict: "proceed",
            declared: { width: null }
        });
        expect(await compressImageBytes(malformed, keepWidth)).toEqual({ compressed: false, reason: "no-gain" });
    });

    it("is scaled at a high fallback quality when its own quality cannot be read", async () => {
        const outcome = await compressImageBytes(
            withMalformedApp1(jpegAt95), request({ jpegHandling: "keep", maxWidthHeight: 100 }));

        if (!outcome.compressed) {
            throw new Error("expected the scaled image to be smaller");
        }
        const decoded = await Jimp.fromBuffer(Buffer.from(outcome.buffer));
        expect([ decoded.bitmap.width, decoded.bitmap.height ]).toEqual([ 100, 75 ]);
        expect(Math.abs((estimateJpegQuality(outcome.buffer) ?? 0) - 92)).toBeLessThanOrEqual(2);
    });
});

describe("detectSvg", () => {
    it("rejects a buffer holding nothing but whitespace, or nothing at all", () => {
        expect(detectSvg(new TextEncoder().encode(" \t\r\n"))).toBeNull();
        expect(detectSvg(new Uint8Array(0))).toBeNull();
        expect(detectSvg(new TextEncoder().encode("\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>")))
            .toEqual({ ext: "svg", mime: "image/svg+xml" });
    });
});
