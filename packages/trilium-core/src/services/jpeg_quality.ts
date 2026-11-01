/**
 * Recovers the quality setting a JPEG was written at, by reading the quantization table it carries.
 *
 * Needed because re-encoding is unavoidable whenever an image is scaled: there is no way to write
 * new pixels without one. Choosing a fixed quality for that would be wrong in both directions — too
 * low quietly degrades an image nobody asked to degrade, and too high inflates bytes-per-pixel so
 * far that a modest resize produces a *larger* file than it started from, and gets rejected, leaving
 * the resize silently undone. Re-encoding at the quality the image already had avoids both.
 */

/**
 * The quality `buffer` appears to have been written at, 1 to 100, or `null` when that cannot be
 * read — a buffer that is not a JPEG, one carrying no luminance table, or one whose table says
 * nothing usable. Callers pick their own fallback.
 *
 * Approximate by nature: it inverts the scaling libjpeg applies to the standard table, so an
 * encoder that scales differently is estimated a few points out. That is harmless here, where the
 * figure only picks a re-encoding target rather than reproducing anything exactly.
 */
export function estimateJpegQuality(buffer: Uint8Array): number | null {
    const table = readLuminanceQuantizationTable(buffer);

    return table ? qualityFromTable(table) : null;
}

/**
 * Inverts libjpeg's scaling of the standard table. It writes each coefficient as
 * `(standard * scale + 50) / 100` clamped into a byte, so each one that did not hit that clamp
 * gives back an estimate of `scale`, and the median of those is robust against the few that did.
 */
function qualityFromTable(table: number[]): number | null {
    const scales: number[] = [];

    for (let index = 0; index < COEFFICIENT_COUNT; index++) {
        // A coefficient pinned at the top of the byte range was clamped rather than scaled, so it
        // carries no information about how far it was scaled. Ones pinned at the bottom are kept:
        // at high quality most of the table is 1s, and dropping them would leave nothing to read.
        if (table[index] >= MAX_COEFFICIENT) {
            continue;
        }

        scales.push((table[index] * 100 - 50) / STANDARD_LUMINANCE[ZIGZAG_TO_NATURAL[index]]);
    }

    if (scales.length === 0) {
        return null;
    }

    const scale = median(scales);
    // The other half of libjpeg's mapping, run backwards.
    const quality = scale < 100 ? (200 - scale) / 2 : 5000 / scale;

    return Math.min(Math.max(Math.round(quality), 1), 100);
}

/**
 * The 64 luminance coefficients, in the zig-zag order they are stored in, or `null` if the buffer
 * holds no such table.
 *
 * Walks the segment structure rather than searching for the marker bytes, since `FF DB` occurs
 * freely inside entropy-coded data and thumbnails.
 */
function readLuminanceQuantizationTable(buffer: Uint8Array): number[] | null {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== MARKER_SOI) {
        return null;
    }

    let offset = 2;

    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            // Out of step with the segments; nothing further can be read with any confidence.
            return null;
        }

        const marker = buffer[offset + 1];

        if (marker === 0xff) {
            // Fill bytes are allowed to pad ahead of a marker.
            offset++;
            continue;
        }

        if (marker === MARKER_SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            // Standalone markers carry no length to skip by.
            offset += 2;
            continue;
        }

        if (marker === MARKER_SOS || marker === MARKER_EOI) {
            // Entropy-coded data begins here, and every table precedes it.
            return null;
        }

        const length = (buffer[offset + 2] << 8) | buffer[offset + 3];

        if (length < 2 || offset + 2 + length > buffer.length) {
            return null;
        }

        if (marker === MARKER_DQT) {
            const table = findLuminanceTable(buffer, offset + 4, offset + 2 + length);

            if (table) {
                return table;
            }
        }

        offset += 2 + length;
    }

    return null;
}

/** One DQT segment can hold several tables back to back; only the luminance one is wanted. */
function findLuminanceTable(buffer: Uint8Array, start: number, end: number): number[] | null {
    let offset = start;

    while (offset < end) {
        const precision = buffer[offset] >> 4;
        const identifier = buffer[offset] & 0x0f;
        const bytesPerCoefficient = precision === 0 ? 1 : 2;
        const size = COEFFICIENT_COUNT * bytesPerCoefficient;

        offset++;

        if (offset + size > end) {
            return null;
        }

        if (identifier === LUMINANCE_TABLE_ID) {
            return Array.from({ length: COEFFICIENT_COUNT }, (_unused, index) => (
                bytesPerCoefficient === 1
                    ? buffer[offset + index]
                    : (buffer[offset + index * 2] << 8) | buffer[offset + index * 2 + 1]
            ));
        }

        offset += size;
    }

    return null;
}

function median(values: number[]): number {
    const sorted = [ ...values ].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const MARKER_SOI = 0xd8;
const MARKER_DQT = 0xdb;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;

/** Table 0 is the luminance one by convention, and the one whose scaling tracks the quality. */
const LUMINANCE_TABLE_ID = 0;
const COEFFICIENT_COUNT = 64;
const MAX_COEFFICIENT = 255;

/** The standard luminance quantization table (JPEG Annex K), in natural row-major order. */
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

/** Where each zig-zag position lands in the natural order above, tables being stored zig-zagged. */
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
