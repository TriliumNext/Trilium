import {
    createCipheriv as nodeCreateCipheriv,
    createHash as nodeCreateHash,
    createHmac as nodeCreateHmac,
    scryptSync as nodeScrypt
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import BrowserCryptoProvider from "./crypto_provider.js";

const provider = new BrowserCryptoProvider();

describe("BrowserCryptoProvider hashing", () => {
    it("produces fixed-length digests for md5/sha1/sha512", () => {
        expect(provider.createHash("md5", "hello")).toHaveLength(16);
        expect(provider.createHash("sha1", "hello")).toHaveLength(20);
        expect(provider.createHash("sha512", "hello")).toHaveLength(64);
    });

    it("accepts Uint8Array input", () => {
        const bytes = new Uint8Array([1, 2, 3]);
        expect(provider.createHash("md5", bytes)).toHaveLength(16);
    });

    it("hmac returns a base64 string", () => {
        const mac = provider.hmac("secret", "value");
        expect(typeof mac).toBe("string");
        // base64 of a 32-byte sha256 digest is 44 chars
        expect(mac).toHaveLength(44);
    });
});

describe("BrowserCryptoProvider parity with the Node.js provider", () => {
    // The same document is opened by both the server/desktop (node:crypto) and the standalone
    // app (this provider), so every digest must be byte-identical across the two. The binary
    // vector is deliberately NOT valid UTF-8: a regression here once routed bytes through a
    // lossy UTF-8 decode (invalid sequences become U+FFFD), which passed for strings and
    // ASCII-ish bytes but made protected binary notes fail their integrity digest and decrypt
    // to empty on standalone/mobile.
    const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i); // contains invalid UTF-8
    const largeBinary = Uint8Array.from({ length: 50_000 }, (_, i) => (i * 31 + 7) % 256);
    const utf8String = "héllo — 世界";

    it("createHash matches node:crypto for strings and for (invalid-UTF-8) binary content", () => {
        for (const algorithm of ["md5", "sha1", "sha512"] as const) {
            for (const content of ["", new Uint8Array(0), utf8String, allBytes, largeBinary]) {
                const expected = new Uint8Array(nodeCreateHash(algorithm).update(content).digest());
                expect(provider.createHash(algorithm, content), `${algorithm} of ${typeof content === "string" ? "string" : `${content.length} bytes`}`).toEqual(expected);
            }
        }
    });

    it("hmac matches node:crypto for string and binary secrets/values", () => {
        const cases: [string | Uint8Array, string | Uint8Array][] = [
            ["secret", "value"],
            ["", ""],
            [new Uint8Array(100).fill(1), "a secret longer than the block size is hashed first"],
            [allBytes, largeBinary],
            ["secret", allBytes]
        ];
        for (const [secret, value] of cases) {
            const expected = nodeCreateHmac("sha256", secret).update(value).digest("base64");
            expect(provider.hmac(secret, value)).toBe(expected);
        }
    });

    it("scrypt matches node:crypto with the production parameters and with custom ones", async () => {
        // N=16384, r=8, p=1 and a 32-byte key are what `scrypt.ts` in core passes.
        expect(await provider.scrypt("pässword", "salt-string", 32, { N: 16384, r: 8, p: 1 }))
            .toEqual(new Uint8Array(nodeScrypt("pässword", "salt-string", 32, { N: 16384, r: 8, p: 1 })));

        const salt = largeBinary.subarray(0, 64);
        expect(await provider.scrypt(allBytes, salt, 64, { N: 1024, r: 4, p: 2 }))
            .toEqual(new Uint8Array(nodeScrypt(allBytes, salt, 64, { N: 1024, r: 4, p: 2 })));
    });

    it("scrypt defaults to N=16384, r=8, p=1", async () => {
        const expected = new Uint8Array(nodeScrypt("password", "salt", 32, { N: 16384, r: 8, p: 1 }));
        expect(await provider.scrypt("password", "salt", 32)).toEqual(expected);
        expect(await provider.scrypt("password", "salt", 32, { N: 16384 })).toEqual(expected);
    });

    describe("aes-128-cbc", () => {
        const key = Uint8Array.from({ length: 16 }, (_, i) => i * 13);
        const iv = Uint8Array.from({ length: 16 }, (_, i) => 255 - i);
        const lengths = [ 0, 1, 15, 16, 17, 31, 32, 33, 1000 ];

        it("encrypts byte for byte like node:crypto, for every length around the block size", () => {
            for (const length of lengths) {
                const plain = largeBinary.subarray(0, length);

                const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
                const encrypted = concat(cipher.update(plain), cipher.final());

                expect(encrypted, `${length} bytes`).toEqual(nodeEncrypt(key, iv, plain));
            }
        });

        it("decrypts what node:crypto encrypted, for every length around the block size", () => {
            for (const length of lengths) {
                const plain = largeBinary.subarray(0, length);

                const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
                const decrypted = concat(decipher.update(nodeEncrypt(key, iv, plain)), decipher.final());

                expect(decrypted, `${length} bytes`).toEqual(new Uint8Array(plain));
            }
        });

        it("joins the chunks passed to update() in order", () => {
            const plain = largeBinary.subarray(0, 100);
            const encrypted = nodeEncrypt(key, iv, plain);

            const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
            expect(concat(
                cipher.update(plain.subarray(0, 7)),
                cipher.update(plain.subarray(7, 40)),
                cipher.update(plain.subarray(40)),
                cipher.final()
            )).toEqual(encrypted);

            const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
            expect(concat(
                decipher.update(encrypted.subarray(0, 5)),
                decipher.update(encrypted.subarray(5)),
                decipher.final()
            )).toEqual(new Uint8Array(plain));
        });

        it("returns bytes rather than throwing when decrypting with a wrong key", () => {
            // `data_encryption.decrypt()` detects a wrong key through its digest and returns false.
            // Most wrong keys leave invalid padding, which must not throw before that check.
            const encrypted = nodeEncrypt(key, iv, largeBinary.subarray(0, 50));
            for (let i = 1; i <= 64; i++) {
                const decipher = provider.createDecipheriv("aes-128-cbc", key.map((byte) => byte ^ i), iv);
                decipher.update(encrypted);
                expect(() => decipher.final(), `key xor ${i}`).not.toThrow();
            }
        });

        it("throws for ciphertext that is not a whole number of blocks", () => {
            const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
            decipher.update(new Uint8Array(20));
            expect(() => decipher.final()).toThrow();
        });
    });
});

describe("BrowserCryptoProvider random helpers", () => {
    it("randomBytes returns the requested size", () => {
        expect(provider.randomBytes(8)).toHaveLength(8);
    });

    it("randomString returns the requested length using the allowed alphabet", () => {
        const str = provider.randomString(20);
        expect(str).toHaveLength(20);
        expect(str).toMatch(/^[0-9A-Za-z]+$/);
    });
});

describe("BrowserCryptoProvider constantTimeCompare", () => {
    it("returns true for equal arrays", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it("returns false for different lengths", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });

    it("returns false for same-length differing content", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    });
});

describe("BrowserCryptoProvider scrypt", () => {
    it("derives a key of the requested length", async () => {
        const key = await provider.scrypt("password", "salt", 16, { N: 16, r: 1, p: 1 });
        expect(key).toHaveLength(16);
    });

    it("uses default scrypt parameters when none are supplied", async () => {
        const key = await provider.scrypt(new Uint8Array([1]), new Uint8Array([2]), 8, { N: 2 });
        expect(key).toHaveLength(8);
    });
});

describe("AesJsCipher (via createCipheriv/createDecipheriv)", () => {
    const key = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(16).fill(9);

    it("round-trips data through encryption and decryption", () => {
        const plain = new TextEncoder().encode("the quick brown fox");

        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.update(plain);
        const encrypted = cipher.final();

        const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
        decipher.update(encrypted);
        const decrypted = decipher.final();

        expect(new TextDecoder().decode(decrypted)).toBe("the quick brown fox");
    });

    it("throws when update() is called after final()", () => {
        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.update(new Uint8Array([1]));
        cipher.final();
        expect(() => cipher.update(new Uint8Array([2]))).toThrow("Cipher has already been finalized");
    });

    it("throws when final() is called twice", () => {
        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.final();
        expect(() => cipher.final()).toThrow("Cipher has already been finalized");
    });

    it("returns decrypted bytes unchanged when the trailing padding byte is out of range", () => {
        for (const last of [ 0, 17, 255 ]) {
            const plain = new Uint8Array(32).fill(65);
            plain[31] = last;

            const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
            decipher.update(nodeEncrypt(key, iv, plain, false));

            expect(decipher.final(), `last byte ${last}`).toEqual(plain);
        }
    });

    it("strips as many bytes as the trailing padding byte says, without checking the others", () => {
        const plain = new Uint8Array(32).fill(65);
        plain[31] = 3;

        const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
        decipher.update(nodeEncrypt(key, iv, plain, false));

        expect(decipher.final()).toEqual(plain.subarray(0, 29));
    });
});

describe("BrowserCryptoProvider base64", () => {
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

    it("round-trips a large buffer spanning multiple 32K chunks", () => {
        const bytes = new Uint8Array(100_000); // > CHUNK (0x8000), forces the multi-chunk path
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
        const round = provider.base64Decode(provider.base64Encode(bytes));
        expect(Array.from(round)).toEqual(Array.from(bytes));
    });

    it("encodes a Uint8Array view (subarray with a non-zero offset)", () => {
        const backing = new Uint8Array([0xff, 0xff, 0x66, 0x6f, 0x6f, 0xff]); // "foo" in the middle
        expect(provider.base64Encode(backing.subarray(2, 5))).toBe("Zm9v");
    });

    describe("native (TC39 arraybuffer-base64) fast path", () => {
        // The test runtime may or may not ship the native methods; save whatever is there and
        // restore it afterwards, so stubbing never clobbers a real implementation.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const proto = Uint8Array.prototype as any;
        const ctor = Uint8Array as any;
        const savedToBase64 = proto.toBase64;
        const savedFromBase64 = ctor.fromBase64;

        afterEach(() => {
            if (savedToBase64 === undefined) delete proto.toBase64;
            else proto.toBase64 = savedToBase64;
            if (savedFromBase64 === undefined) delete ctor.fromBase64;
            else ctor.fromBase64 = savedFromBase64;
        });

        it("prefers Uint8Array.prototype.toBase64 for encoding when the runtime provides it", () => {
            proto.toBase64 = function (this: Uint8Array) {
                return `NATIVE(${this.length})`;
            };
            expect(provider.base64Encode(new Uint8Array(3))).toBe("NATIVE(3)");
        });

        it("prefers Uint8Array.fromBase64 for decoding when the runtime provides it", () => {
            ctor.fromBase64 = (base64: string) => new Uint8Array([base64.length]);
            expect(Array.from(provider.base64Decode("abcd"))).toEqual([4]);
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    describe("fallback decoder (WebView < 140, no native fromBase64)", () => {
        // Force the pure-JS decoder — the exact path the mobile WebView 136 takes — by removing the
        // native method for the duration of these tests.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const ctor = Uint8Array as any;
        const savedFromBase64 = ctor.fromBase64;
        beforeEach(() => delete ctor.fromBase64);
        afterEach(() => {
            if (savedFromBase64 === undefined) delete ctor.fromBase64;
            else ctor.fromBase64 = savedFromBase64;
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        it("decodes the RFC 4648 vectors (no atob intermediate)", () => {
            for (const [input, expected] of vectors) {
                expect(decoder.decode(provider.base64Decode(expected))).toBe(input);
            }
        });

        it("handles empty input and both padding lengths", () => {
            expect(provider.base64Decode("")).toHaveLength(0);
            expect(Array.from(provider.base64Decode("Zg=="))).toEqual([0x66]); // 1 byte, 2 pad
            expect(Array.from(provider.base64Decode("Zm8="))).toEqual([0x66, 0x6f]); // 2 bytes, 1 pad
            expect(Array.from(provider.base64Decode("Zm9v"))).toEqual([0x66, 0x6f, 0x6f]); // 3 bytes, no pad
        });

        it("round-trips every byte value 0..255 on the fallback path", () => {
            const bytes = new Uint8Array(256);
            for (let i = 0; i < 256; i++) bytes[i] = i;
            expect(Array.from(provider.base64Decode(provider.base64Encode(bytes)))).toEqual(Array.from(bytes));
        });

        it("round-trips a large buffer whose length is not a multiple of 3", () => {
            const bytes = new Uint8Array(100_003);
            for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
            expect(Array.from(provider.base64Decode(provider.base64Encode(bytes)))).toEqual(Array.from(bytes));
        });

        it("ignores embedded whitespace instead of decoding it as zero bytes (atob / native parity)", () => {
            // Line-wrapped and space-separated base64 must decode identically to the compact form,
            // not emit spurious 0x00 bytes for the newlines/spaces.
            expect(decoder.decode(provider.base64Decode("Zm9v\nYmFy"))).toBe("foobar");
            expect(decoder.decode(provider.base64Decode("Zm9v YmFy"))).toBe("foobar");
            expect(decoder.decode(provider.base64Decode("  Zm9v\r\nYmFy  \n"))).toBe("foobar");
            // Whitespace around padding is tolerated too.
            expect(Array.from(provider.base64Decode("Zg =="))).toEqual([0x66]);
            expect(Array.from(provider.base64Decode("Z m 8 ="))).toEqual([0x66, 0x6f]);
        });

        it("round-trips a large buffer that is line-wrapped every 76 chars (MIME style)", () => {
            const bytes = new Uint8Array(50_000);
            for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + 3) & 0xff;
            const wrapped = provider.base64Encode(bytes).replace(/(.{76})/g, "$1\n");
            expect(Array.from(provider.base64Decode(wrapped))).toEqual(Array.from(bytes));
        });
    });

    describe("base64DecodeInto (pooled decode for the sync blob path)", () => {
        // Force the pure-JS in-place decoder — same rationale as the fallback decoder suite.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const proto = Uint8Array.prototype as any;
        const savedSetFromBase64 = proto.setFromBase64;
        beforeEach(() => delete proto.setFromBase64);
        afterEach(() => {
            if (savedSetFromBase64 === undefined) delete proto.setFromBase64;
            else proto.setFromBase64 = savedSetFromBase64;
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */

        it("decodes into the given buffer and returns the number of bytes written", () => {
            const target = new Uint8Array(16);
            const written = provider.base64DecodeInto("Zm9vYmFy", target);

            expect(written).toBe(6);
            expect(decoder.decode(target.subarray(0, written))).toBe("foobar");
        });

        it("reusing the same buffer across decodes yields correct, uncontaminated results", () => {
            const pool = new Uint8Array(32);

            const first = provider.base64DecodeInto(provider.base64Encode(new TextEncoder().encode("first-blob-content")), pool);
            expect(decoder.decode(pool.subarray(0, first))).toBe("first-blob-content");

            const second = provider.base64DecodeInto(provider.base64Encode(new TextEncoder().encode("2nd")), pool);
            expect(second).toBe(3);
            expect(decoder.decode(pool.subarray(0, second))).toBe("2nd");
        });

        it("skips whitespace and padding, writing fewer bytes than the upper bound", () => {
            const target = new Uint8Array(16);
            const written = provider.base64DecodeInto("Zm9v\nYmFy\n", target);

            expect(written).toBe(6);
            expect(decoder.decode(target.subarray(0, written))).toBe("foobar");
        });

        it("matches base64Decode output for every byte value", () => {
            const bytes = new Uint8Array(256);
            for (let i = 0; i < 256; i++) bytes[i] = i;
            const base64 = provider.base64Encode(bytes);

            const target = new Uint8Array((base64.length * 3) >> 2);
            const written = provider.base64DecodeInto(base64, target);

            expect(Array.from(target.subarray(0, written ?? 0))).toEqual(Array.from(bytes));
        });

        it("prefers the native setFromBase64 when the runtime provides it", () => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            (Uint8Array.prototype as any).setFromBase64 = function (base64: string) {
                this[0] = base64.length;
                return { read: base64.length, written: 1 };
            };
            /* eslint-enable @typescript-eslint/no-explicit-any */

            const target = new Uint8Array(4);
            expect(provider.base64DecodeInto("abcd", target)).toBe(1);
            expect(target[0]).toBe(4);
        });
    });
});

/** Encrypts `plain` with node:crypto, with PKCS#7 padding unless `autoPadding` is false. */
function nodeEncrypt(key: Uint8Array, iv: Uint8Array, plain: Uint8Array, autoPadding = true) {
    const cipher = nodeCreateCipheriv("aes-128-cbc", key, iv).setAutoPadding(autoPadding);
    return concat(cipher.update(plain), cipher.final());
}

function concat(...parts: Uint8Array[]) {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
