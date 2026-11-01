import { describe, expect, it } from "vitest";

import { inspectImage, UNKNOWN_FORMAT } from "./image_inspect.js";

/**
 * Hand-built headers rather than real images: the point of this module is that it reads the bytes
 * and never decodes, so the bytes are what the tests should be made of. It also keeps the spec
 * runnable on every runtime, having no image library behind it.
 */

/** A PNG signature followed by an IHDR chunk stating the given size, depth and colour type. */
function png(width: number, height: number, { depth = 8, colorType = 6 } = {}): Uint8Array {
    return Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        ...uint32(width), ...uint32(height),
        depth, colorType, 0x00, 0x00, 0x00
    ]);
}

/**
 * A JPEG made of the segments that matter: optionally something ahead of the frame header, then
 * the frame header itself, which is where the size is stated.
 */
function jpeg(width: number, height: number, { marker = 0xc0, before = [] as number[] } = {}): Uint8Array {
    return Uint8Array.from([
        0xff, 0xd8,
        ...before,
        0xff, marker, 0x00, 0x11, 0x08,
        (height >> 8) & 0xff, height & 0xff,
        (width >> 8) & 0xff, width & 0xff,
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
    ]);
}

/** An APP1 segment of `length` payload bytes, standing in for the EXIF a camera writes. */
function app1(length: number): number[] {
    return [ 0xff, 0xe1, ((length + 2) >> 8) & 0xff, (length + 2) & 0xff, ...new Array(length).fill(0) ];
}

function uint32(value: number): number[] {
    return [ (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff ];
}

/** An icon directory stating one entry of the given size, each edge a single byte. */
function ico(width: number, height: number): Uint8Array {
    return bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00, width & 0xff, height & 0xff);
}

/** An ISO base media file: a box length, the `ftyp` tag, then the brand that says what it holds. */
function isoBmff(brand: string): Uint8Array {
    return bytes(0x00, 0x00, 0x00, 0x18, ...[ ..."ftyp" ].map((c) => c.charCodeAt(0)), ...[ ...brand ].map((c) => c.charCodeAt(0)));
}

function bytes(...values: number[]): Uint8Array {
    // Padded past the length below which nothing is read at all.
    return Uint8Array.from([ ...values, ...new Array(Math.max(0, 16 - values.length)).fill(0) ]);
}

const text = (value: string) => new TextEncoder().encode(value);

describe("inspectImage", () => {
    it("identifies the formats a note can hold, with their mime types", () => {
        expect(inspectImage(png(1, 1))).toMatchObject({ format: "png", mime: "image/png" });
        expect(inspectImage(jpeg(1, 1))).toMatchObject({ format: "jpg", mime: "image/jpeg" });
        expect(inspectImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toMatchObject({ format: "gif", mime: "image/gif" });
        expect(inspectImage(bytes(0x42, 0x4d))).toMatchObject({ format: "bmp", mime: "image/bmp" });
        expect(inspectImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)))
            .toMatchObject({ format: "webp", mime: "image/webp" });
        expect(inspectImage(text("<svg xmlns='http://www.w3.org/2000/svg'></svg>")))
            .toMatchObject({ format: "svg", mime: "image/svg+xml" });
        expect(inspectImage(ico(16, 16))).toMatchObject({ format: "ico", mime: "image/x-icon" });
        expect(inspectImage(isoBmff("avif"))).toMatchObject({ format: "avif", mime: "image/avif" });
    });

    it("reads the AVIF sequence brand, which an <img> draws just the same", () => {
        expect(inspectImage(isoBmff("avis")).format).toBe("avif");
        // Other things are packed in the same container and are not pictures.
        expect(inspectImage(isoBmff("mp42")).format).toBe(UNKNOWN_FORMAT);
        expect(inspectImage(isoBmff("heic")).format).toBe(UNKNOWN_FORMAT);
    });

    it("does not read a cursor as an icon", () => {
        // Same directory layout, type 2 rather than 1 — not something a note holds, and reporting
        // it as an icon would have it served as one.
        expect(inspectImage(bytes(0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x20, 0x20)).format).toBe(UNKNOWN_FORMAT);
    });

    it("recognises an SVG behind an XML declaration", () => {
        expect(inspectImage(text("<?xml version='1.0'?>\n<svg></svg>")).format).toBe("svg");
        // A declaration introducing something else is not one.
        expect(inspectImage(text("<?xml version='1.0'?><html></html>")).format).toBe(UNKNOWN_FORMAT);
    });

    it.each([
        [ "an unrecognisable buffer", () => bytes(1, 2, 3, 4, 5, 6, 7, 8) ],
        [ "a buffer too short to hold any header", () => Uint8Array.from([ 0x89, 0x50, 0x4e ]) ],
        [ "an empty buffer", () => new Uint8Array() ]
    ])("answers %s as unknown, with a fallback mime", (_label, build) => {
        expect(inspectImage(build())).toMatchObject({
            format: UNKNOWN_FORMAT,
            mime: "application/octet-stream",
            width: null,
            height: null
        });
    });

    describe("dimensions", () => {
        it("reads a PNG from its IHDR chunk", () => {
            expect(inspectImage(png(1920, 1080))).toMatchObject({ width: 1920, height: 1080 });
        });

        it("reads a JPEG from its frame header", () => {
            expect(inspectImage(jpeg(800, 600))).toMatchObject({ width: 800, height: 600 });
        });

        it("walks past what a camera writes ahead of the frame header", () => {
            // The reason the segments are walked rather than the marker searched for: EXIF and a
            // thumbnail sit between the start of the file and the size it states.
            expect(inspectImage(jpeg(800, 600, { before: app1(64) }))).toMatchObject({ width: 800, height: 600 });
        });

        it.each([
            [ "baseline", 0xc0 ],
            [ "progressive", 0xc2 ],
            [ "arithmetic-coded", 0xc9 ]
        ])("reads a %s frame header, every coding stating the same thing", (_label, marker) => {
            expect(inspectImage(jpeg(320, 240, { marker }))).toMatchObject({ width: 320, height: 240 });
        });

        it("is not fooled by a table segment that is not a frame header at all", () => {
            // 0xC4 is a Huffman table, which sits in the same marker range and states no size.
            const withTable = jpeg(320, 240, { before: [ 0xff, 0xc4, 0x00, 0x06, 0, 0, 0, 0 ] });

            expect(inspectImage(withTable)).toMatchObject({ width: 320, height: 240 });
        });

        it("reads a GIF from its screen descriptor, little-endian", () => {
            const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0xc0, 0x02);

            expect(inspectImage(gif)).toMatchObject({ format: "gif", width: 800, height: 704 });
        });

        it("reads a BMP from its DIB header, an upside-down one included", () => {
            const bmp = new Uint8Array(30);
            bmp.set([ 0x42, 0x4d ]);
            // Width 640, then a negative height, which is how a top-down bitmap states 480.
            bmp.set([ 0x80, 0x02, 0x00, 0x00 ], 18);
            bmp.set([ 0x20, 0xfe, 0xff, 0xff ], 22);

            expect(inspectImage(bmp)).toMatchObject({ format: "bmp", width: 640, height: 480 });
        });

        it("reads an ICO from its first directory entry, where 0 means 256", () => {
            expect(inspectImage(ico(48, 32))).toMatchObject({ width: 48, height: 32 });
            // A single byte per edge cannot hold 256, so the format spends 0 on it.
            expect(inspectImage(ico(0, 0))).toMatchObject({ width: 256, height: 256 });
        });

        it("measures nothing for a format whose header it does not read", () => {
            const webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

            expect(inspectImage(webp)).toMatchObject({ format: "webp", width: null, height: null });
        });

        it.each([
            [ "greyscale", 0, { channels: 1, hasAlpha: false, indexed: false } ],
            [ "colour", 2, { channels: 3, hasAlpha: false, indexed: false } ],
            // Already quantized, which is the thing worth knowing before offering to quantize it.
            [ "a palette", 3, { channels: 1, hasAlpha: false, indexed: true } ],
            [ "greyscale with alpha", 4, { channels: 2, hasAlpha: true, indexed: false } ],
            [ "colour with alpha", 6, { channels: 4, hasAlpha: true, indexed: false } ]
        ])("reads a PNG storing %s", (_label, colorType, expected) => {
            expect(inspectImage(png(8, 8, { colorType }))).toMatchObject(expected);
        });

        it("reads how many bits a channel is given, a deep PNG included", () => {
            expect(inspectImage(png(8, 8, { depth: 8 })).bitDepth).toBe(8);
            expect(inspectImage(png(8, 8, { depth: 16 })).bitDepth).toBe(16);
        });

        it("reads a JPEG's precision and components, which never carry an alpha channel", () => {
            expect(inspectImage(jpeg(8, 8))).toMatchObject({
                bitDepth: 8, channels: 3, hasAlpha: false, indexed: false
            });
        });

        it.each([
            [ "a PNG cut off before its IHDR", () => Uint8Array.from([ ...png(10, 10) ].slice(0, 20)) ],
            [ "a JPEG with no frame header", () => Uint8Array.from([ 0xff, 0xd8, ...app1(16) ]) ],
            [ "a JPEG whose segments do not line up", () => Uint8Array.from([ 0xff, 0xd8, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0, 0, 0 ]) ]
        ])("answers no size for %s rather than guessing one", (_label, build) => {
            expect(inspectImage(build())).toMatchObject({ width: null, height: null });
        });
    });
});
