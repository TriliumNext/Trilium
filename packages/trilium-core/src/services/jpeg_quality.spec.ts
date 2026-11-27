import { describe, expect, it } from "vitest";

import { estimateJpegQuality } from "./jpeg_quality.js";

/**
 * Hand-built segment streams: the estimate reads nothing but the segment structure and the table,
 * so a JPEG with no picture behind its tables answers the same as a real one.
 */
describe("estimateJpegQuality", () => {
    it("reads the quality back from the luminance table, in either precision", () => {
        expect(estimateJpegQuality(jpeg(dqt(0, QUALITY_50)))).toBe(50);
        expect(estimateJpegQuality(jpeg(dqt(0, QUALITY_50, 16)))).toBe(50);
        expect(estimateJpegQuality(jpeg(dqt(0, QUALITY_50.map((value) => Math.max(1, Math.round(value / 4)))))))
            .toBeGreaterThan(85);
        // Below 50 libjpeg scales by 5000 / quality, so a table four times the standard one is 12.5.
        expect(estimateJpegQuality(jpeg(dqt(0, QUALITY_50.map((value) => Math.min(254, value * 4)))))).toBe(13);
        // A coefficient clamped at 255 says nothing and is left out of the median.
        expect(estimateJpegQuality(jpeg(dqt(0, [ 255, ...QUALITY_50.slice(1) ])))).toBe(50);
    });

    it("walks past fill bytes, standalone markers and the chrominance table to the luminance one", () => {
        const chrominanceThenLuminance = segment(0xdb, [ ...table(1, QUALITY_50.map(() => 99)), ...table(0, QUALITY_50) ]);

        expect(estimateJpegQuality(Uint8Array.from([
            0xff, 0xd8, 0xff, 0xff, 0x01, 0xff, 0xd0, ...segment(0xe0, [ 0, 0 ]), ...chrominanceThenLuminance
        ]))).toBe(50);
        // A segment holding only the chrominance table is passed over for one that follows.
        expect(estimateJpegQuality(jpeg(dqt(1, QUALITY_50), dqt(0, QUALITY_50)))).toBe(50);
    });

    it.each([
        [ "something that is not a JPEG", Uint8Array.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a ]) ],
        [ "a JPEG too short to hold a segment", Uint8Array.from([ 0xff, 0xd8, 0xff ]) ],
        [ "a table every coefficient of which was clamped", jpeg(dqt(0, QUALITY_50.map(() => 255))) ],
        [ "segments that fall out of step", Uint8Array.from([ 0xff, 0xd8, 0x12, 0x34, 0x56, 0x78 ]) ],
        [ "image data before any table", jpeg(segment(0xda, [ 0, 0 ]), dqt(0, QUALITY_50)) ],
        [ "the end of the image before any table", Uint8Array.from([ 0xff, 0xd8, 0xff, 0xd9, 0, 0 ]) ],
        [ "a segment length below its own size", Uint8Array.from([ 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01 ]) ],
        [ "a segment running past the end", Uint8Array.from([ 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0 ]) ],
        [ "segments that end before any table", jpeg(segment(0xe0, [ 0, 0, 0 ])) ],
        [ "only a chrominance table", jpeg(dqt(1, QUALITY_50)) ],
        [ "a table cut short by its segment", jpeg(segment(0xdb, [ 0x00, 1, 2, 3 ])) ]
    ])("answers nothing for %s", (_label, bytes) => {
        expect(estimateJpegQuality(bytes)).toBeNull();
    });
});

/** The standard luminance table (JPEG Annex K), in natural row-major order. */
const STANDARD_LUMINANCE = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
];

const ZIGZAG_TO_NATURAL = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
];

/** What libjpeg writes at quality 50, whose scale of 100 leaves the standard table as it is. */
const QUALITY_50 = ZIGZAG_TO_NATURAL.map((natural) => STANDARD_LUMINANCE[natural]);

function jpeg(...segments: number[][]) {
    return Uint8Array.from([ 0xff, 0xd8, ...segments.flat() ]);
}

function segment(marker: number, payload: number[]) {
    const length = payload.length + 2;
    return [ 0xff, marker, length >> 8, length & 0xff, ...payload ];
}

function dqt(identifier: number, coefficients: number[], precision: 8 | 16 = 8) {
    return segment(0xdb, table(identifier, coefficients, precision));
}

function table(identifier: number, coefficients: number[], precision: 8 | 16 = 8) {
    return precision === 8
        ? [ identifier, ...coefficients ]
        : [ 0x10 | identifier, ...coefficients.flatMap((value) => [ value >> 8, value & 0xff ]) ];
}
