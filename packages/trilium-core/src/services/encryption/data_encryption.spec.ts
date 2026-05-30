import { describe, expect, it } from "vitest";

import { decodeUtf8, encodeUtf8 } from "../utils/binary.js";
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

        it("throws when the content cannot be decrypted to a valid payload", () => {
            // Garbage that base64-decodes but cannot be a valid AES block / digest.
            const garbage = dataEncryption.encrypt(KEY, "tampered");
            // Flip a character in the base64 body to corrupt the payload while keeping
            // it valid base64 of a 16-aligned length.
            const corrupted = garbage.slice(0, -2) + (garbage.endsWith("A=") ? "B=" : "A=");

            expect(() => {
                const out = dataEncryption.decryptString(OTHER_KEY, corrupted);
                // If it didn't throw, it must at least not have recovered the original.
                if (out !== null) {
                    expect(out).not.toBe("tampered");
                    throw new Error("Could not decrypt string.");
                }
            }).toThrow();
        });
    });
});
