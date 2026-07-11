import { describe, expect, it } from "vitest";

import NodejsCryptoProvider from "./crypto_provider.js";

const provider = new NodejsCryptoProvider();

describe("NodejsCryptoProvider base64", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // RFC 4648 §10 test vectors
    const vectors: [string, string][] = [
        ["", ""],
        ["f", "Zg=="],
        ["fo", "Zm8="],
        ["foo", "Zm9v"],
        ["foob", "Zm9vYg=="],
        ["fooba", "Zm9vYmE="],
        ["foobar", "Zm9vYmFy"]
    ];

    it("encodes the RFC 4648 test vectors", () => {
        for (const [input, expected] of vectors) {
            expect(provider.base64Encode(encoder.encode(input))).toBe(expected);
        }
    });

    it("decodes the RFC 4648 test vectors", () => {
        for (const [input, expected] of vectors) {
            expect(decoder.decode(provider.base64Decode(expected))).toBe(input);
        }
    });

    it("round-trips every byte value 0..255", () => {
        const bytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) bytes[i] = i;
        expect(Array.from(provider.base64Decode(provider.base64Encode(bytes)))).toEqual(Array.from(bytes));
    });

    it("round-trips a large buffer", () => {
        const bytes = new Uint8Array(100_000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
        expect(Array.from(provider.base64Decode(provider.base64Encode(bytes)))).toEqual(Array.from(bytes));
    });

    it("encodes a Uint8Array view with a non-zero byteOffset (zero-copy path stays correct)", () => {
        // The native implementation views the backing ArrayBuffer via byteOffset/byteLength;
        // a subarray must encode only its own window, not the whole backing buffer.
        const backing = new Uint8Array([0xff, 0xff, 0x66, 0x6f, 0x6f, 0xff]); // "foo" in the middle
        expect(provider.base64Encode(backing.subarray(2, 5))).toBe("Zm9v");
    });

    it("returns empty for empty input", () => {
        expect(provider.base64Encode(new Uint8Array(0))).toBe("");
        expect(provider.base64Decode("")).toHaveLength(0);
    });
});
