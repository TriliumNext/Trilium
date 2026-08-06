import { estimateJpegQuality } from "@triliumnext/core";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Round-trips real JPEGs through the estimator: encode at a known quality, read it back off the
 * quantization table. Jimp's encoder scales the standard table the way libjpeg does, which is the
 * relationship the estimator inverts, so agreement here is the whole test.
 */
let photo: InstanceType<typeof Jimp>;

beforeAll(() => {
    photo = new Jimp({ width: 240, height: 160, color: 0x000000ff });
    for (let x = 0; x < 240; x++) {
        for (let y = 0; y < 160; y++) {
            const r = Math.round(128 + 127 * Math.sin(x / 20));
            const g = Math.round(128 + 127 * Math.sin(y / 15));
            const b = Math.round(128 + 127 * Math.sin((x + y) / 25));
            photo.setPixelColor((((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0), x, y);
        }
    }
});

async function encodedAt(quality: number): Promise<Uint8Array> {
    return new Uint8Array(await photo.getBuffer("image/jpeg", { quality }));
}

describe("estimateJpegQuality", () => {
    it.each([ 20, 40, 60, 75, 85, 95 ])("reads back a quality of %i within a few points", async (quality) => {
        const estimate = estimateJpegQuality(await encodedAt(quality));

        expect(estimate).not.toBeNull();
        expect(Math.abs((estimate ?? 0) - quality)).toBeLessThanOrEqual(5);
    });

    it("reads the top of the range as the top of the range", async () => {
        // Every coefficient is 1 there, which is the case the estimator has least to work with.
        const estimate = estimateJpegQuality(await encodedAt(100));

        expect(estimate).toBeGreaterThanOrEqual(95);
        expect(estimate).toBeLessThanOrEqual(100);
    });

    it("orders estimates as the qualities they came from are ordered", async () => {
        const estimates = await Promise.all([ 30, 50, 70, 90 ].map(async (quality) => (
            estimateJpegQuality(await encodedAt(quality)) ?? 0
        )));

        expect(estimates).toEqual([ ...estimates ].sort((a, b) => a - b));
    });

    it("finds the table behind an EXIF segment rather than giving up at the first marker", async () => {
        const jpeg = Buffer.from(await encodedAt(60));
        // A JPEG straight off a camera carries APP1 before its tables; walking the segments has to
        // step over it rather than assume the table comes first.
        const app1 = Buffer.concat([
            Buffer.from([ 0xff, 0xe1, 0x00, 0x10 ]),
            Buffer.from("Exif\0\0", "latin1"),
            Buffer.alloc(8)
        ]);
        const withExif = new Uint8Array(Buffer.concat([ jpeg.subarray(0, 2), app1, jpeg.subarray(2) ]));

        expect(Math.abs((estimateJpegQuality(withExif) ?? 0) - 60)).toBeLessThanOrEqual(5);
    });

    it.each([
        [ "a PNG", () => new Uint8Array([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4 ]) ],
        [ "an empty buffer", () => new Uint8Array() ],
        [ "a bare SOI with nothing after it", () => new Uint8Array([ 0xff, 0xd8 ]) ],
        [ "a JPEG whose segments do not line up", () => new Uint8Array([ 0xff, 0xd8, 0x12, 0x34, 0x56, 0x78 ]) ]
    ])("answers nothing for %s, leaving the caller its own fallback", (_label, build) => {
        expect(estimateJpegQuality(build())).toBeNull();
    });

    it("answers nothing for a JPEG truncated before its tables", async () => {
        const jpeg = await encodedAt(60);

        // Cut at the SOI: the scan reaches the end of the buffer without meeting a DQT.
        expect(estimateJpegQuality(jpeg.slice(0, 2))).toBeNull();
    });
});
