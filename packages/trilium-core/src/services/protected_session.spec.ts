import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodeUtf8, encodeUtf8 } from "./utils/binary.js";
import protectedSession from "./protected_session.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore,
// which wires up the Node.js crypto provider that data_encryption (used by
// encrypt/decrypt/decryptString below) relies on via getCrypto(). No DB/becca
// access is needed here, so there's no CLS requirement. The module keeps a single
// module-level data key, so each test resets it to avoid cross-test leakage.

const KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

describe("protected_session", () => {
    beforeEach(() => {
        protectedSession.resetDataKey();
    });

    afterEach(() => {
        protectedSession.resetDataKey();
    });

    describe("data key lifecycle / availability", () => {
        it("is unavailable until a key is set and available afterwards", () => {
            expect(protectedSession.isProtectedSessionAvailable()).toBe(false);

            protectedSession.setDataKey(KEY);
            expect(protectedSession.isProtectedSessionAvailable()).toBe(true);
        });

        it("resetDataKey makes the session unavailable again", () => {
            protectedSession.setDataKey(KEY);
            expect(protectedSession.isProtectedSessionAvailable()).toBe(true);

            protectedSession.resetDataKey();
            expect(protectedSession.isProtectedSessionAvailable()).toBe(false);
        });

        it("setDataKey copies the input so later mutation of the caller's array is ignored", () => {
            const mutable = Uint8Array.from(KEY);
            protectedSession.setDataKey(mutable);

            const cipherText = protectedSession.encrypt("copy check") as string;

            // Mutating the caller's array after setDataKey must not affect the stored key.
            mutable.fill(0);

            const decrypted = protectedSession.decryptString(cipherText);
            expect(decrypted).toBe("copy check");
        });
    });

    describe("encrypt / decrypt / decryptString without a key", () => {
        it("returns null for encrypt, decrypt and decryptString when no key is set", () => {
            expect(protectedSession.encrypt("anything")).toBeNull();
            expect(protectedSession.decrypt("anything")).toBeNull();
            expect(protectedSession.decryptString("anything")).toBeNull();
        });

        it("encrypt returns null for null plaintext even after a key is set", () => {
            protectedSession.setDataKey(KEY);
            expect(protectedSession.encrypt(null as unknown as string)).toBeNull();
        });

        it("decrypt returns null for null ciphertext even after a key is set", () => {
            protectedSession.setDataKey(KEY);
            expect(protectedSession.decrypt(null as unknown as string)).toBeNull();
        });
    });

    describe("encrypt / decrypt round-trip with a key", () => {
        beforeEach(() => {
            protectedSession.setDataKey(KEY);
        });

        it("round-trips a plain string via encrypt + decrypt", () => {
            const cipherText = protectedSession.encrypt("hello world") as string;
            expect(typeof cipherText).toBe("string");

            const decrypted = protectedSession.decrypt(cipherText);
            expect(decrypted).not.toBeNull();
            expect(decodeUtf8(decrypted as Uint8Array)).toBe("hello world");
        });

        it("round-trips a Uint8Array payload (binary content)", () => {
            const payload = Uint8Array.from([0, 1, 2, 254, 255, 10, 13]);
            const cipherText = protectedSession.encrypt(payload) as string;

            const decrypted = protectedSession.decrypt(cipherText) as Uint8Array;
            expect(Array.from(decrypted)).toEqual(Array.from(payload));
        });

        it("decryptString returns the original string for a string round-trip", () => {
            const cipherText = protectedSession.encrypt("decrypt me") as string;
            expect(protectedSession.decryptString(cipherText)).toBe("decrypt me");
        });
    });

    describe("touchProtectedSession / getLastProtectedSessionOperationDate", () => {
        it("does not record an operation date while the session is unavailable", () => {
            protectedSession.touchProtectedSession();
            // resetDataKey only clears the key, not the recorded date, so the only way to
            // assert "did not touch" is that touching while unavailable is a no-op: set a
            // baseline with a key, reset, then touch while unavailable and confirm the date
            // is unchanged.
            protectedSession.setDataKey(KEY);
            protectedSession.touchProtectedSession();
            const baseline = protectedSession.getLastProtectedSessionOperationDate();
            expect(baseline).not.toBeNull();

            protectedSession.resetDataKey();
            protectedSession.touchProtectedSession();
            expect(protectedSession.getLastProtectedSessionOperationDate()).toBe(baseline);
        });

        it("records the current time when touched while the session is available", () => {
            protectedSession.setDataKey(KEY);

            const before = Date.now();
            protectedSession.touchProtectedSession();
            const after = Date.now();

            const date = protectedSession.getLastProtectedSessionOperationDate();
            expect(date).not.toBeNull();
            expect(date as number).toBeGreaterThanOrEqual(before);
            expect(date as number).toBeLessThanOrEqual(after);
        });
    });
});
