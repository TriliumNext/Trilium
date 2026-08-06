import { describe, expect, it } from "vitest";

import { trimIcoToSmallestEntry } from "./ico.js";

interface FakeEntry {
    edge: number;
    payload: Uint8Array;
}

/** Bytes that stand in for a picture, distinct per entry so the right one can be recognised. */
function payload(marker: number, length = 8): Uint8Array {
    return Uint8Array.from({ length }, () => marker);
}

/** The signature a PNG-carrying entry opens with, the larger sizes in a real icon using that form. */
const PNG_SIGNATURE = Uint8Array.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);

/** Builds an icon file holding the given pictures, laid out the way a real one is. */
function buildIco(entries: FakeEntry[], { type = 1 } = {}): Uint8Array {
    const directorySize = 6 + entries.length * 16;
    const bytes = new Uint8Array(directorySize + entries.reduce((sum, e) => sum + e.payload.byteLength, 0));
    const view = new DataView(bytes.buffer);

    view.setUint16(2, type, true);
    view.setUint16(4, entries.length, true);

    let offset = directorySize;

    for (const [ index, entry ] of entries.entries()) {
        const at = 6 + index * 16;

        // One byte per edge; 256 is written as 0, which is the whole reason it wraps.
        bytes[at] = entry.edge % 256;
        bytes[at + 1] = entry.edge % 256;
        view.setUint16(at + 4, 1, true); // colour planes
        view.setUint16(at + 6, 32, true); // bits per pixel
        view.setUint32(at + 8, entry.payload.byteLength, true);
        view.setUint32(at + 12, offset, true);
        bytes.set(entry.payload, offset);
        offset += entry.payload.byteLength;
    }

    return bytes;
}

/** Reads back what a trimmed file says it holds. */
function readTrimmed(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    return {
        count: view.getUint16(4, true),
        edge: bytes[6] || 256,
        pictureAt: view.getUint32(6 + 12, true),
        picture: bytes.subarray(22)
    };
}

describe("trimIcoToSmallestEntry", () => {
    it("keeps the smallest picture worth drawing and drops the rest", () => {
        // The shape a site's icon actually takes — Trilium's own carries these six sizes, of which
        // a preview draws the first and stores all of them.
        const original = buildIco([
            { edge: 16, payload: payload(0x11) },
            { edge: 32, payload: payload(0x22, 64) },
            { edge: 48, payload: payload(0x33, 128) },
            { edge: 64, payload: payload(0x44, 256) },
            { edge: 128, payload: payload(0x55, 512) },
            { edge: 256, payload: payload(0x66, 1024) }
        ]);

        const trimmed = trimIcoToSmallestEntry(original);
        expect(trimmed).not.toBeNull();

        const result = readTrimmed(trimmed ?? new Uint8Array());
        expect(result.count).toBe(1);
        expect(result.edge).toBe(16);
        expect(result.picture).toStrictEqual(payload(0x11));
        // The picture now starts directly after the one entry that is left.
        expect(result.pictureAt).toBe(22);
        expect(trimmed?.byteLength).toBeLessThan(original.byteLength / 10);
    });

    it("copies the picture across untouched, whichever form it is in", () => {
        // Nothing is decoded, so the older BMP form and the PNG form used for larger sizes are
        // handled by the same code — which is what makes this cheap enough to be worth doing.
        const png = new Uint8Array([ ...PNG_SIGNATURE, 1, 2, 3 ]);
        const trimmed = trimIcoToSmallestEntry(buildIco([
            { edge: 256, payload: png },
            { edge: 16, payload: payload(0xab, 12) }
        ]));

        expect(readTrimmed(trimmed ?? new Uint8Array()).picture).toStrictEqual(payload(0xab, 12));

        // And the same file read with a floor no entry but the PNG one clears.
        const keptPng = trimIcoToSmallestEntry(buildIco([
            { edge: 256, payload: png },
            { edge: 16, payload: payload(0xab, 12) }
        ]), 32);

        expect(readTrimmed(keptPng ?? new Uint8Array()).picture).toStrictEqual(png);
    });

    it("reads an edge of 0 as 256 rather than as nothing", () => {
        // Written as 0 because a byte cannot hold 256. Read literally it would look like the
        // smallest picture in the file instead of the largest.
        const trimmed = trimIcoToSmallestEntry(buildIco([
            { edge: 256, payload: payload(0xaa) },
            { edge: 8, payload: payload(0xbb) }
        ]));

        // 8 is below the floor, so the 256 is the only one usable — which it would not be if its
        // edge had been read as 0.
        expect(readTrimmed(trimmed ?? new Uint8Array()).picture).toStrictEqual(payload(0xaa));
    });

    it("takes the floor it is given, a preview wanting more pixels than it draws", () => {
        // Drawn at 16 CSS pixels, so 16 is what a 2x display upscales. The caller asks for the size
        // that covers the screens it might be opened on, not the size it lays out at.
        const sizes = [ 16, 32, 48, 64, 128 ].map((edge) => ({ edge, payload: payload(edge) }));

        expect(readTrimmed(trimIcoToSmallestEntry(buildIco(sizes)) ?? new Uint8Array()).edge).toBe(16);
        expect(readTrimmed(trimIcoToSmallestEntry(buildIco(sizes), 48) ?? new Uint8Array()).edge).toBe(48);
        // Nothing that large on offer: the largest there is, rather than nothing.
        expect(readTrimmed(trimIcoToSmallestEntry(buildIco(sizes), 512) ?? new Uint8Array()).edge).toBe(128);
    });

    it("settles for the largest when every picture is below the floor", () => {
        const trimmed = trimIcoToSmallestEntry(buildIco([
            { edge: 8, payload: payload(0xcc) },
            { edge: 12, payload: payload(0xdd) }
        ]));

        expect(readTrimmed(trimmed ?? new Uint8Array()).edge).toBe(12);
        expect(readTrimmed(trimmed ?? new Uint8Array()).picture).toStrictEqual(payload(0xdd));
    });

    it("answers nothing when the file is one picture already", () => {
        // Not a failure — there is simply nothing to drop, and the caller keeps what it had.
        expect(trimIcoToSmallestEntry(buildIco([ { edge: 32, payload: payload(0x01) } ]))).toBeNull();
    });

    it("answers nothing for bytes that are not an icon directory", () => {
        expect(trimIcoToSmallestEntry(PNG_SIGNATURE)).toBeNull();
        expect(trimIcoToSmallestEntry(new Uint8Array())).toBeNull();
        expect(trimIcoToSmallestEntry(new Uint8Array([ 0, 0, 1 ]))).toBeNull();
        // A cursor shares the layout but is not a picture a note holds.
        expect(trimIcoToSmallestEntry(buildIco([
            { edge: 16, payload: payload(1) },
            { edge: 32, payload: payload(2) }
        ], { type: 2 }))).toBeNull();
    });

    it("refuses a directory it cannot read in full, rather than reading past the end", () => {
        // These bytes are whatever a linked site served, so a length or offset that does not fit
        // the file has to answer nothing instead of reaching outside it.
        const claimsMoreEntriesThanFit = new Uint8Array(6 + 16);
        new DataView(claimsMoreEntriesThanFit.buffer).setUint16(2, 1, true);
        new DataView(claimsMoreEntriesThanFit.buffer).setUint16(4, 5, true);
        expect(trimIcoToSmallestEntry(claimsMoreEntriesThanFit)).toBeNull();

        const runsPastTheEnd = buildIco([
            { edge: 16, payload: payload(1) },
            { edge: 32, payload: payload(2) }
        ]);
        new DataView(runsPastTheEnd.buffer).setUint32(6 + 8, 0xffff, true);
        expect(trimIcoToSmallestEntry(runsPastTheEnd)).toBeNull();

        const startsInsideTheDirectory = buildIco([
            { edge: 16, payload: payload(1) },
            { edge: 32, payload: payload(2) }
        ]);
        new DataView(startsInsideTheDirectory.buffer).setUint32(6 + 12, 2, true);
        expect(trimIcoToSmallestEntry(startsInsideTheDirectory)).toBeNull();

        const holdsNothing = buildIco([
            { edge: 16, payload: payload(1) },
            { edge: 32, payload: payload(2) }
        ]);
        new DataView(holdsNothing.buffer).setUint32(6 + 8, 0, true);
        expect(trimIcoToSmallestEntry(holdsNothing)).toBeNull();
    });
});
