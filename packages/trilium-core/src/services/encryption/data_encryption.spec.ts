import { describe, expect, it, vi } from "vitest";

import { getLog } from "../log.js";
import { concat2, decodeUtf8, encodeBase64, encodeUtf8 } from "../utils/binary.js";
import { getCrypto } from "./crypto.js";
import dataEncryption from "./data_encryption.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore,
// which wires up the Node.js crypto provider that data_encryption relies on via
// getCrypto(). No DB/becca access is needed here, so there's no CLS requirement.

const KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes
const OTHER_KEY = encodeUtf8("fedcba9876543210");

describe("data_encryption", () => {
    describe("encrypt + decrypt round-trip", () => {
        it("round-trips a plain string payload", () => {
            const cipherText = dataEncryption.encrypt(KEY, "hello world");
            expect(typeof cipherText).toBe("string");

            const decrypted = dataEncryption.decrypt(KEY, cipherText);
            expect(decrypted).not.toBe(false);
            expect(decrypted).not.toBeNull();
            expect(decodeUtf8(decrypted as Uint8Array)).toBe("hello world");
        });

        it("round-trips a Uint8Array payload (binary content)", () => {
            const payload = Uint8Array.from([0, 1, 2, 254, 255, 10, 13]);
            const cipherText = dataEncryption.encrypt(KEY, payload);

            const decrypted = dataEncryption.decrypt(KEY, cipherText) as Uint8Array;
            expect(Array.from(decrypted)).toEqual(Array.from(payload));
        });

        it("round-trips unicode and empty content", () => {
            const unicode = "héllo — ✓ 世界";
            expect(decodeUtf8(dataEncryption.decrypt(KEY, dataEncryption.encrypt(KEY, unicode)) as Uint8Array)).toBe(unicode);

            const empty = dataEncryption.decrypt(KEY, dataEncryption.encrypt(KEY, "")) as Uint8Array;
            expect(decodeUtf8(empty)).toBe("");
        });

        it("produces a different ciphertext each time (random IV) but both decrypt equally", () => {
            const a = dataEncryption.encrypt(KEY, "same input");
            const b = dataEncryption.encrypt(KEY, "same input");
            expect(a).not.toBe(b);

            expect(decodeUtf8(dataEncryption.decrypt(KEY, a) as Uint8Array)).toBe("same input");
            expect(decodeUtf8(dataEncryption.decrypt(KEY, b) as Uint8Array)).toBe("same input");
        });

        it("decrypt accepts the ciphertext passed as a Uint8Array as well as a string", () => {
            const cipherText = dataEncryption.encrypt(KEY, "buffer cipher");
            const asBuffer = encodeUtf8(cipherText);

            const decrypted = dataEncryption.decrypt(KEY, asBuffer) as Uint8Array;
            expect(decodeUtf8(decrypted)).toBe("buffer cipher");
        });
    });

    describe("encrypt error handling", () => {
        it("throws when no key is supplied", () => {
            expect(() => dataEncryption.encrypt(undefined as unknown as Uint8Array, "x")).toThrow("No data key!");
        });
    });

    describe("decrypt edge cases", () => {
        it("returns null when the ciphertext is null", () => {
            expect(dataEncryption.decrypt(KEY, null as unknown as string)).toBeNull();
        });

        it("returns the [protected] marker when no key is available", () => {
            const result = dataEncryption.decrypt(undefined as unknown as Uint8Array, "anything");
            expect(decodeUtf8(result as Uint8Array)).toBe("[protected]");
        });

        it("fails to recover content when decrypting with the wrong key", () => {
            const cipherText = dataEncryption.encrypt(KEY, "secret payload");

            // A wrong key either fails the PKCS#7 padding check (throw) or, if padding
            // happens to validate, fails the embedded SHA-1 digest check (false). Either
            // way the original plaintext must never be recovered.
            let recovered: Uint8Array | false | null = false;
            try {
                recovered = dataEncryption.decrypt(OTHER_KEY, cipherText);
            } catch {
                recovered = false;
            }

            if (recovered) {
                expect(decodeUtf8(recovered)).not.toBe("secret payload");
            } else {
                expect(recovered).toBe(false);
            }
        });

        it("hands back a value that cannot be ciphertext unchanged (zadam/trilium#510)", () => {
            // 40 bytes take a 13-byte IV, which leaves 27 bytes: not a whole number of blocks.
            const misaligned = encodeBase64(Uint8Array.from({ length: 40 }, (_, i) => i));
            // A 16-byte IV with no block after it.
            const ivOnly = encodeBase64(new Uint8Array(16).fill(5));

            for (const value of [ misaligned, ivOnly ]) {
                expect(dataEncryption.decrypt(KEY, value), value).toEqual(encodeUtf8(value));
                expect(dataEncryption.decrypt(KEY, encodeUtf8(value)), value).toEqual(encodeUtf8(value));
            }
        });
    });

    describe("digest check", () => {
        /** Encrypts `plainText` as stored, without the SHA-1 digest prefix `encrypt()` adds. */
        function encryptRaw(plainText: Uint8Array) {
            const iv = new Uint8Array(16);
            const cipher = getCrypto().createCipheriv("aes-128-cbc", KEY, iv);
            return encodeBase64(concat2(iv, concat2(cipher.update(plainText), cipher.final())));
        }

        it("rejects a plaintext shorter than the 4-byte digest it should start with", () => {
            expect(dataEncryption.decrypt(KEY, encryptRaw(Uint8Array.of(1, 2)))).toBe(false);
        });

        it("rejects a payload whose digest does not match, and decryptString reports it", () => {
            const payload = encodeUtf8("tampered");
            expect(Array.from(getCrypto().createHash("sha1", payload).slice(0, 4))).not.toEqual([ 0, 0, 0, 0 ]);
            const cipherText = encryptRaw(concat2(new Uint8Array(4), payload));
            const error = vi.spyOn(getLog(), "error").mockImplementation(() => {});

            expect(dataEncryption.decrypt(KEY, cipherText)).toBe(false);
            expect(() => dataEncryption.decryptString(KEY, cipherText)).toThrow("Could not decrypt string.");
            expect(error).toHaveBeenCalledOnce();
            error.mockRestore();
        });
    });

    describe("decryptString", () => {
        it("round-trips a string and returns a string", () => {
            const cipherText = dataEncryption.encrypt(KEY, "decrypt me");
            const result = dataEncryption.decryptString(KEY, cipherText);
            expect(result).toBe("decrypt me");
        });

        it("returns null when the ciphertext is null", () => {
            expect(dataEncryption.decryptString(KEY, null as unknown as string)).toBeNull();
        });
    });
});
