import { describe, expect, it, vi } from "vitest";

import options from "../options.js";
import { getContext } from "../context.js";
import passwordEncryption from "./password_encryption.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore
// with an in-memory copy of the fixture DB (password "demo1234"), which wires up
// the Node.js crypto provider used via getCrypto() and seeds the
// passwordVerificationHash / *Salt / encryptedDataKey options this module reads.
// Each spec file runs in its own vitest fork (pool: "forks"), so the option
// mutations below isolate to this file. The `it()`s share the single fixture DB,
// so the destructive verification-hash test is kept last.
const FIXTURE_PASSWORD = "demo1234";

// scrypt (N=16384) runs in pure JS (scrypt-js) under the browser provider, which is
// ~10x slower under V8 coverage instrumentation than Node's native scryptSync. Give the
// standalone (happy-dom) suite a larger timeout; the server suite keeps the strict
// default. The derived bytes are identical across runtimes — only the speed differs.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

describe("password_encryption (real DB)", () => {
    describe("verifyPassword", () => {
        it("returns true for the seeded fixture password and false for a wrong one", async () => {
            expect(await passwordEncryption.verifyPassword(FIXTURE_PASSWORD)).toBe(true);
            expect(await passwordEncryption.verifyPassword("definitely-not-it")).toBe(false);
            // Verification is case- and whitespace-sensitive.
            expect(await passwordEncryption.verifyPassword(" demo1234")).toBe(false);
            expect(await passwordEncryption.verifyPassword("DEMO1234")).toBe(false);
        });
    });

    describe("getDataKey", () => {
        it("recovers a Uint8Array data key with the correct password", async () => {
            const dataKey = await passwordEncryption.getDataKey(FIXTURE_PASSWORD);

            expect(dataKey).toBeInstanceOf(Uint8Array);
            expect((dataKey as Uint8Array).length).toBeGreaterThan(0);
        });

        it("does not recover the data key with a wrong password", async () => {
            const correct = (await passwordEncryption.getDataKey(FIXTURE_PASSWORD)) as Uint8Array;

            // A wrong password derives a different key, so decryption either fails the
            // embedded digest check (false) or, rarely, returns bytes that differ from
            // the real key. Either way the real data key must never be recovered.
            let recovered: Uint8Array | false | null;
            try {
                recovered = await passwordEncryption.getDataKey("the-wrong-password");
            } catch {
                recovered = false;
            }

            if (recovered instanceof Uint8Array) {
                expect(Array.from(recovered)).not.toEqual(Array.from(correct));
            } else {
                expect(recovered).toBe(false);
            }
        });
    });

    describe("setDataKey + getDataKey round-trip", () => {
        it("re-encrypts a string data key so it decrypts back to the same bytes", async () => {
            const before = (await passwordEncryption.getDataKey(FIXTURE_PASSWORD)) as Uint8Array;
            const oldCipher = options.getOption("encryptedDataKey");

            const plainTextKey = "0123456789abcdef"; // 16 chars
            await getContext().init(() =>
                passwordEncryption.setDataKey(FIXTURE_PASSWORD, plainTextKey)
            );

            // A fresh IV makes the stored ciphertext change even for the same plaintext.
            expect(options.getOption("encryptedDataKey")).not.toBe(oldCipher);

            const after = (await passwordEncryption.getDataKey(FIXTURE_PASSWORD)) as Uint8Array;
            expect(after).toBeInstanceOf(Uint8Array);
            expect(new TextDecoder().decode(after)).toBe(plainTextKey);
            // The newly stored key differs from whatever the fixture shipped with.
            expect(Array.from(after)).not.toEqual(Array.from(before));
        });

        it("round-trips a Uint8Array data key under a different password", async () => {
            const otherPassword = "another-pass-789";
            const rawKey = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

            await getContext().init(() => passwordEncryption.setDataKey(otherPassword, rawKey));

            const recovered = (await passwordEncryption.getDataKey(otherPassword)) as Uint8Array;
            expect(Array.from(recovered)).toEqual(Array.from(rawKey));

            // Reading the same encrypted key back with the previous password no longer works.
            let withOldPassword: Uint8Array | false | null;
            try {
                withOldPassword = await passwordEncryption.getDataKey(FIXTURE_PASSWORD);
            } catch {
                withOldPassword = false;
            }
            if (withOldPassword instanceof Uint8Array) {
                expect(Array.from(withOldPassword)).not.toEqual(Array.from(rawKey));
            } else {
                expect(withOldPassword).toBe(false);
            }
        });
    });

    describe("verifyPassword without a stored hash", () => {
        it("returns false for any password once passwordVerificationHash is empty", async () => {
            // Kept last: clearing the stored hash is destructive for this fork's DB.
            getContext().init(() => options.setOption("passwordVerificationHash", ""));

            expect(await passwordEncryption.verifyPassword(FIXTURE_PASSWORD)).toBe(false);
            expect(await passwordEncryption.verifyPassword("anything")).toBe(false);
        });
    });
});
