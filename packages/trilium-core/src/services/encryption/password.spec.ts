import { describe, expect, it, vi } from "vitest";

import options from "../options.js";
import { getContext } from "../context.js";
import passwordEncryptionService from "./password_encryption.js";
import passwordService from "./password.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore
// with an in-memory copy of the fixture DB, which already has a password set
// ("demo1234"). Each spec file runs in its own vitest fork (pool: "forks"), so
// the mutations below isolate to this file. The `it()`s nonetheless share the
// single fixture DB, so they're ordered to flow from "password set" through to
// the destructive reset/re-set at the end.
const FIXTURE_PASSWORD = "demo1234";

// scrypt (N=16384) runs in pure JS (scrypt-js) under the browser provider, which is
// ~10x slower under V8 coverage instrumentation than Node's native scryptSync. Give the
// standalone (happy-dom) suite a larger timeout; the server suite keeps the strict
// default. The derived bytes are identical across runtimes — only the speed differs.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

/**
 * Wraps a callback in a CLS context. The mutating password operations call
 * options.setOption/createOption, which save BOption entities and therefore
 * require an initialised CLS context.
 */
function withContext<T>(fn: () => T): T {
    return getContext().init(fn);
}

describe("password service (real DB)", () => {
    describe("isPasswordSet", () => {
        it("reports true for the seeded fixture which already has a password", () => {
            expect(passwordService.isPasswordSet()).toBe(true);
        });
    });

    describe("setPassword", () => {
        it("throws when a password is already set", async () => {
            await expect(passwordService.setPassword("whatever")).rejects.toThrow(
                /Password is set already/
            );
        });
    });

    describe("changePassword", () => {
        it("returns failure (without throwing) when the current password is wrong", async () => {
            const result = await passwordService.changePassword("not-the-password", "newPass1");

            expect(result.success).toBe(false);
            expect(result.message).toBe("Given current password doesn't match hash");

            // A failed attempt must not have touched the stored verification hash.
            expect(await passwordEncryptionService.verifyPassword(FIXTURE_PASSWORD)).toBe(true);
        });

        it("re-encrypts the data key, rotates the salts, and lets the new password verify", async () => {
            const oldHash = options.getOption("passwordVerificationHash");
            const oldVerificationSalt = options.getOption("passwordVerificationSalt");
            const oldDerivedKeySalt = options.getOption("passwordDerivedKeySalt");
            const oldEncryptedDataKey = options.getOption("encryptedDataKey");

            // The data key recovered with the old password is what must survive the rotation.
            const dataKeyBefore = (await passwordEncryptionService.getDataKey(
                FIXTURE_PASSWORD
            )) as Uint8Array;
            expect(dataKeyBefore).toBeInstanceOf(Uint8Array);

            const newPassword = "brandNewPass-123";
            const result = await withContext(() =>
                passwordService.changePassword(FIXTURE_PASSWORD, newPassword)
            );
            expect(result.success).toBe(true);

            // Verification hash and both salts were rotated.
            expect(options.getOption("passwordVerificationHash")).not.toBe(oldHash);
            expect(options.getOption("passwordVerificationSalt")).not.toBe(oldVerificationSalt);
            expect(options.getOption("passwordDerivedKeySalt")).not.toBe(oldDerivedKeySalt);
            // The data key is stored encrypted under a new key, so the ciphertext changes too.
            expect(options.getOption("encryptedDataKey")).not.toBe(oldEncryptedDataKey);

            // The new password verifies, the old one no longer does.
            expect(await passwordEncryptionService.verifyPassword(newPassword)).toBe(true);
            expect(await passwordEncryptionService.verifyPassword(FIXTURE_PASSWORD)).toBe(false);

            // The underlying data key is preserved across the re-encryption.
            const dataKeyAfter = (await passwordEncryptionService.getDataKey(
                newPassword
            )) as Uint8Array;
            expect(Array.from(dataKeyAfter)).toEqual(Array.from(dataKeyBefore));
        });
    });

    describe("resetPassword", () => {
        it("clears every password-related option and makes isPasswordSet false", () => {
            const result = withContext(() => passwordService.resetPassword());

            expect(result.success).toBe(true);
            expect(options.getOption("passwordVerificationHash")).toBe("");
            expect(options.getOption("passwordVerificationSalt")).toBe("");
            expect(options.getOption("passwordDerivedKeySalt")).toBe("");
            expect(options.getOption("encryptedDataKey")).toBe("");

            expect(passwordService.isPasswordSet()).toBe(false);
        });

        it("makes changePassword throw because there is no longer a password to change", async () => {
            await expect(passwordService.changePassword("a", "b")).rejects.toThrow(
                /Password has not been set yet/
            );
        });
    });

    describe("setPassword after a reset", () => {
        it("creates a fresh, verifiable password and a recoverable data key", async () => {
            const freshPassword = "freshlySet-456";

            const result = await withContext(() => passwordService.setPassword(freshPassword));
            expect(result.success).toBe(true);

            expect(passwordService.isPasswordSet()).toBe(true);
            expect(options.getOption("passwordVerificationSalt")).not.toBe("");
            expect(options.getOption("passwordDerivedKeySalt")).not.toBe("");
            expect(options.getOption("encryptedDataKey")).not.toBe("");

            expect(await passwordEncryptionService.verifyPassword(freshPassword)).toBe(true);

            // A freshly generated 16-byte data key must decrypt back cleanly.
            const dataKey = (await passwordEncryptionService.getDataKey(
                freshPassword
            )) as Uint8Array;
            expect(dataKey).toBeInstanceOf(Uint8Array);
            expect(dataKey.length).toBe(16);
        });
    });
});
