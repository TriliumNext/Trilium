import { describe, expect, it } from "vitest";

import {
    concat2,
    decodeBase64,
    decodeUtf8,
    encodeBase64,
    encodeUtf8,
    processStringOrBuffer,
    stripBom,
    truncateUtf8Bytes,
    unwrapStringOrBuffer,
    wrapStringOrBuffer
} from "./binary.js";

describe("binary utils", () => {
    describe("concat2", () => {
        it("joins two byte arrays preserving order and length", () => {
            const a = new Uint8Array([1, 2, 3]);
            const b = new Uint8Array([4, 5]);
            const out = concat2(a, b);

            expect(out).toBeInstanceOf(Uint8Array);
            expect(out.length).toBe(5);
            expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
        });

        it("handles empty inputs on either side", () => {
            const empty = new Uint8Array([]);
            const data = new Uint8Array([9, 8]);

            expect(Array.from(concat2(empty, data))).toEqual([9, 8]);
            expect(Array.from(concat2(data, empty))).toEqual([9, 8]);
            expect(concat2(empty, empty).length).toBe(0);
        });

        it("does not mutate the source arrays", () => {
            const a = new Uint8Array([1, 2]);
            const b = new Uint8Array([3, 4]);
            concat2(a, b);

            expect(Array.from(a)).toEqual([1, 2]);
            expect(Array.from(b)).toEqual([3, 4]);
        });
    });

    describe("encodeUtf8 / decodeUtf8", () => {
        it("encodes a string into its UTF-8 byte representation", () => {
            const bytes = encodeUtf8("AB");

            expect(bytes).toBeInstanceOf(Uint8Array);
            expect(Array.from(bytes)).toEqual([0x41, 0x42]);
        });

        it("encodes multi-byte (non-ASCII) characters correctly", () => {
            // "é" => 0xC3 0xA9, "€" => 0xE2 0x82 0xAC
            expect(Array.from(encodeUtf8("é"))).toEqual([0xc3, 0xa9]);
            expect(Array.from(encodeUtf8("€"))).toEqual([0xe2, 0x82, 0xac]);
        });

        it("accepts a buffer and re-encodes its decoded form", () => {
            const buffer = new Uint8Array([0xc3, 0xa9]); // "é"
            expect(Array.from(encodeUtf8(buffer))).toEqual([0xc3, 0xa9]);
        });

        it("decodes a UTF-8 buffer back into a string", () => {
            expect(decodeUtf8(new Uint8Array([0x41, 0x42]))).toBe("AB");
            expect(decodeUtf8(new Uint8Array([0xc3, 0xa9]))).toBe("é");
        });

        it("returns the string unchanged when given a string", () => {
            expect(decodeUtf8("already a string")).toBe("already a string");
        });

        it("round-trips arbitrary unicode through encode then decode", () => {
            const original = "Hello, 世界! €é";
            expect(decodeUtf8(encodeUtf8(original))).toBe(original);
        });
    });

    describe("wrapStringOrBuffer", () => {
        it("converts a string to a UTF-8 Uint8Array", () => {
            const out = wrapStringOrBuffer("AB");
            expect(out).toBeInstanceOf(Uint8Array);
            expect(Array.from(out)).toEqual([0x41, 0x42]);
        });

        it("returns a buffer unchanged (same reference)", () => {
            const buffer = new Uint8Array([1, 2, 3]);
            expect(wrapStringOrBuffer(buffer)).toBe(buffer);
        });
    });

    describe("unwrapStringOrBuffer", () => {
        it("returns a string unchanged", () => {
            expect(unwrapStringOrBuffer("hello")).toBe("hello");
        });

        it("decodes a buffer to its UTF-8 string", () => {
            expect(unwrapStringOrBuffer(new Uint8Array([0xc3, 0xa9]))).toBe("é");
        });
    });

    describe("encodeBase64 / decodeBase64", () => {
        it("encodes a string to base64", () => {
            // "Man" => "TWFu" is the canonical RFC 4648 example
            expect(encodeBase64("Man")).toBe("TWFu");
        });

        it("encodes a byte buffer to base64", () => {
            expect(encodeBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe("TWFu");
        });

        it("produces padding for inputs whose length is not a multiple of 3", () => {
            expect(encodeBase64("M")).toBe("TQ==");
            expect(encodeBase64("Ma")).toBe("TWE=");
        });

        it("decodes base64 back into the original bytes", () => {
            expect(Array.from(decodeBase64("TWFu"))).toEqual([0x4d, 0x61, 0x6e]);
        });

        it("round-trips multi-byte unicode content", () => {
            const original = "café — 世界";
            const encoded = encodeBase64(original);
            const decoded = decodeUtf8(decodeBase64(encoded));
            expect(decoded).toBe(original);
        });

        it("handles empty input", () => {
            expect(encodeBase64("")).toBe("");
            expect(decodeBase64("").length).toBe(0);
        });

        it("preserves raw binary bytes through a buffer round-trip", () => {
            const bytes = new Uint8Array([0, 255, 128, 1, 254]);
            expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual([0, 255, 128, 1, 254]);
        });

        it("matches the RFC 4648 §10 vectors", () => {
            expect(encodeBase64("")).toBe("");
            expect(encodeBase64("f")).toBe("Zg==");
            expect(encodeBase64("fo")).toBe("Zm8=");
            expect(encodeBase64("foob")).toBe("Zm9vYg==");
            expect(encodeBase64("fooba")).toBe("Zm9vYmE=");
            expect(encodeBase64("foobar")).toBe("Zm9vYmFy");
        });

        it("round-trips every byte value 0..255 through the active provider", () => {
            const bytes = new Uint8Array(256);
            for (let i = 0; i < 256; i++) bytes[i] = i;
            expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
        });

        it("round-trips a large buffer", () => {
            const bytes = new Uint8Array(100_000);
            for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
            expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
        });
    });

    describe("stripBom", () => {
        const BOM = String.fromCharCode(0xfeff);

        it("strips a single leading BOM (U+FEFF), leaving the remainder intact", () => {
            expect(stripBom(BOM + "hello")).toBe("hello");
            // only the first code point is removed, so a second BOM survives
            expect(stripBom(BOM + BOM + "x")).toBe(BOM + "x");
        });

        it("returns the string unchanged when there is no leading BOM", () => {
            expect(stripBom("hello")).toBe("hello");
            expect(stripBom("")).toBe("");
            // a BOM that is not at the start is preserved
            expect(stripBom("a" + BOM + "b")).toBe("a" + BOM + "b");
        });
    });

    describe("truncateUtf8Bytes", () => {
        it("returns the string unchanged when it already fits", () => {
            expect(truncateUtf8Bytes("hello", 255)).toBe("hello");
            expect(truncateUtf8Bytes("hello", 5)).toBe("hello");
            expect(truncateUtf8Bytes("", 0)).toBe("");
        });

        it("truncates ASCII to an exact byte budget", () => {
            expect(truncateUtf8Bytes("hello world", 5)).toBe("hello");
            expect(encodeUtf8(truncateUtf8Bytes("hello world", 5)).length).toBe(5);
        });

        it("never splits a 2-byte character and stays within the budget", () => {
            // "é" is 2 bytes; a budget of 1 cannot hold it, so it is dropped entirely.
            expect(truncateUtf8Bytes("aé", 2)).toBe("a");
            // a budget of 3 fits "aé" (1 + 2 bytes) exactly.
            expect(truncateUtf8Bytes("aé", 3)).toBe("aé");
            // a budget of 2 in the middle of "é" must back up to the boundary.
            const truncated = truncateUtf8Bytes("aéb", 2);
            expect(truncated).toBe("a");
            expect(encodeUtf8(truncated).length).toBeLessThanOrEqual(2);
        });

        it("never splits a 3-byte or 4-byte character (CJK / emoji)", () => {
            // "世" is 3 bytes; budgets below 3 drop it, exactly 3 keeps it.
            expect(truncateUtf8Bytes("世", 2)).toBe("");
            expect(truncateUtf8Bytes("世", 3)).toBe("世");
            // "😀" is 4 bytes (a surrogate pair in JS); a 3-byte budget drops it whole.
            expect(truncateUtf8Bytes("😀", 3)).toBe("");
            expect(truncateUtf8Bytes("😀", 4)).toBe("😀");
        });

        it("keeps the result valid (no replacement characters) when cutting multi-byte text", () => {
            const text = "汉".repeat(10); // 30 bytes
            const result = truncateUtf8Bytes(text, 16); // 16 / 3 = 5 full chars
            expect(result).toBe("汉".repeat(5));
            expect(result).not.toContain("�");
            expect(encodeUtf8(result).length).toBeLessThanOrEqual(16);
        });
    });

    describe("processStringOrBuffer", () => {
        it("returns an empty string for nullish or empty input", () => {
            expect(processStringOrBuffer(null)).toBe("");
            expect(processStringOrBuffer("")).toBe("");
            expect(processStringOrBuffer(new Uint8Array([]))).toBe("");
        });

        it("returns a string unchanged without transformation", () => {
            expect(processStringOrBuffer("plain text")).toBe("plain text");
        });

        it("decodes a plain UTF-8 buffer", () => {
            const buffer = encodeUtf8("Hello UTF-8 world with enough text to detect");
            expect(processStringOrBuffer(buffer)).toBe("Hello UTF-8 world with enough text to detect");
        });

        it("decodes multi-byte (CJK) UTF-8 content", () => {
            const buffer = encodeUtf8("中文测试内容");
            expect(processStringOrBuffer(buffer)).toBe("中文测试内容");
        });

        it("decodes a UTF-16LE buffer with a BOM and strips the BOM", () => {
            // BOM (0xFF 0xFE) followed by "Hi" in little-endian UTF-16
            const buffer = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
            const result = processStringOrBuffer(buffer);
            expect(result).toBe("Hi");
            // ensure the BOM character (U+FEFF) was stripped
            expect(result.charCodeAt(0)).not.toBe(0xfeff);
        });

        it("treats UTF-16 without a BOM as UTF-8 (matching the previous chardet behaviour)", () => {
            // "Hi" in little-endian UTF-16 but with no BOM: chardet never classified this as UTF-16LE
            // either, so it was — and still is — decoded byte-wise as UTF-8 (null high bytes preserved).
            const buffer = new Uint8Array([0x48, 0x00, 0x69, 0x00]);
            expect([...processStringOrBuffer(buffer)].map((c) => c.charCodeAt(0))).toEqual([0x48, 0x00, 0x69, 0x00]);
        });

        it("decodes a plain ASCII buffer as UTF-8", () => {
            const buffer = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
            expect(processStringOrBuffer(buffer)).toBe("abc");
        });
    });
});
