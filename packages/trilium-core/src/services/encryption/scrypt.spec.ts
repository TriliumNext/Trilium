import { describe, expect, it, vi } from "vitest";

import options from "../options.js";
import { encodeBase64 } from "../utils/binary.js";
import scryptService, {
    getPasswordDerivedKey,
    getScryptHash,
    getVerificationHash
} from "./scrypt.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore
// with an in-memory copy of the fixture DB (password "demo1234"). That wires up
// the Node.js crypto provider used by getScryptHash via getCrypto(), and seeds
// the passwordVerificationSalt / passwordDerivedKeySalt / passwordVerificationHash
// options that this module reads. These tests are read-only, so no CLS context
// is required. Each spec file runs in its own vitest fork (pool: "forks").
const FIXTURE_PASSWORD = "demo1234";

// scrypt (N=16384) runs in pure JS (scrypt-js) under the browser provider, which is
// ~10x slower under V8 coverage instrumentation than Node's native scryptSync. Give the
// standalone (happy-dom) suite a larger timeout; the server suite keeps the strict
// default. The derived bytes are identical across runtimes — only the speed differs.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

describe("scrypt (real DB)", () => {
    describe("getScryptHash", () => {
        it("derives a deterministic 32-byte key for a given (password, salt)", async () => {
            const key1 = await getScryptHash("password", "salt");
            const key2 = await getScryptHash("password", "salt");

            expect(key1).toBeInstanceOf(Uint8Array);
            expect(key1.length).toBe(32);
            expect(Array.from(key1)).toEqual(Array.from(key2));
        });

        it("produces different keys for different passwords or salts", async () => {
            const base = await getScryptHash("password", "salt");

            expect(Array.from(await getScryptHash("password", "other-salt"))).not.toEqual(
                Array.from(base)
            );
            expect(Array.from(await getScryptHash("other-password", "salt"))).not.toEqual(
                Array.from(base)
            );
        });

        it("is sensitive to case and whitespace in the password", async () => {
            const base = await getScryptHash("password", "salt");

            expect(Array.from(await getScryptHash("Password", "salt"))).not.toEqual(
                Array.from(base)
            );
            expect(Array.from(await getScryptHash(" password", "salt"))).not.toEqual(
                Array.from(base)
            );
        });

        it("handles an empty password and an empty salt without throwing", async () => {
            const emptyPassword = await getScryptHash("", "salt");
            const emptySalt = await getScryptHash("password", "");

            expect(emptyPassword.length).toBe(32);
            expect(emptySalt.length).toBe(32);
            // Empty inputs still produce a distinct derived key, not all zeros.
            expect(Array.from(emptyPassword)).not.toEqual(Array.from(new Uint8Array(32)));
        });
    });

    describe("getVerificationHash", () => {
        it("hashes the password against the seeded passwordVerificationSalt", async () => {
            const salt = options.getOption("passwordVerificationSalt");
            const hash = await getVerificationHash(FIXTURE_PASSWORD);

            expect(hash).toBeInstanceOf(Uint8Array);
            expect(hash.length).toBe(32);
            // It must equal a direct scrypt of the password with that exact salt.
            expect(Array.from(hash)).toEqual(Array.from(await getScryptHash(FIXTURE_PASSWORD, salt)));
        });

        it("reproduces the stored passwordVerificationHash for the fixture password", async () => {
            // The fixture DB stores base64(getVerificationHash("demo1234")); deriving it
            // afresh must reproduce that stored value bit-for-bit, proving real crypto.
            const recomputed = encodeBase64(await getVerificationHash(FIXTURE_PASSWORD));

            expect(recomputed).toBe(options.getOption("passwordVerificationHash"));
        });

        it("produces a different hash for a wrong password", async () => {
            const correct = await getVerificationHash(FIXTURE_PASSWORD);
            const wrong = await getVerificationHash("not-the-password");

            expect(Array.from(wrong)).not.toEqual(Array.from(correct));
        });
    });

    describe("getPasswordDerivedKey", () => {
        it("hashes the password against the seeded passwordDerivedKeySalt", async () => {
            const salt = options.getOption("passwordDerivedKeySalt");
            const derived = await getPasswordDerivedKey(FIXTURE_PASSWORD);

            expect(derived).toBeInstanceOf(Uint8Array);
            expect(derived.length).toBe(32);
            expect(Array.from(derived)).toEqual(
                Array.from(await getScryptHash(FIXTURE_PASSWORD, salt))
            );
        });

        it("differs from the verification hash because the two use different salts", async () => {
            const verification = await getVerificationHash(FIXTURE_PASSWORD);
            const derived = await getPasswordDerivedKey(FIXTURE_PASSWORD);

            // Same password, distinct salts -> the derived key and verification hash diverge.
            expect(options.getOption("passwordVerificationSalt")).not.toBe(
                options.getOption("passwordDerivedKeySalt")
            );
            expect(Array.from(derived)).not.toEqual(Array.from(verification));
        });
    });

    describe("default export", () => {
        it("exposes the same functions as the named exports", () => {
            expect(scryptService.getScryptHash).toBe(getScryptHash);
            expect(scryptService.getVerificationHash).toBe(getVerificationHash);
            expect(scryptService.getPasswordDerivedKey).toBe(getPasswordDerivedKey);
        });
    });
});
