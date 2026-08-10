import { describe, expect, it } from "vitest";

import {
    bytesEqual,
    concatBytes,
    constantTimeEqual,
    readU16BE,
    readU16LE,
    readU32LE,
    readU64LE,
    utf8,
    writeU16LE,
    writeU32LE,
    writeU64LE
} from "./bytes.js";

describe("byte equality", () => {
    it.each([
        [ "bytesEqual", bytesEqual ],
        [ "constantTimeEqual", constantTimeEqual ]
    ])("%s compares contents and refuses mismatched lengths", (_label, equal) => {
        expect(equal(utf8("abc"), utf8("abc"))).toBe(true);
        expect(equal(utf8("abc"), utf8("abd"))).toBe(false);
        expect(equal(utf8("abc"), utf8("abcd"))).toBe(false);
        expect(equal(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    });
});

describe("concatBytes", () => {
    it("joins parts in order and copes with none", () => {
        expect(concatBytes(utf8("ab"), new Uint8Array(0), utf8("c"))).toEqual(utf8("abc"));
        expect(concatBytes()).toHaveLength(0);
    });
});

describe("integer accessors", () => {
    it("round-trip little-endian values at an offset, even on a subarray", () => {
        const bytes = new Uint8Array(32).subarray(4);

        writeU16LE(bytes, 1, 0xbeef);
        expect(readU16LE(bytes, 1)).toBe(0xbeef);

        writeU32LE(bytes, 3, 0xdead_beef);
        expect(readU32LE(bytes, 3)).toBe(0xdead_beef);

        writeU64LE(bytes, 7, 2n ** 53n);
        expect(readU64LE(bytes, 7)).toBe(2n ** 53n);
    });

    it("reads big-endian, which only the SQLite page size needs", () => {
        expect(readU16BE(new Uint8Array([ 0x10, 0x00 ]), 0)).toBe(4096);
    });
});
