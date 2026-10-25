import { describe, expect, it, vi } from "vitest";

import options from "../options.js";
import { getContext } from "../context.js";
import protectedSessionService from "../protected_session.js";
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
// standalone suite a larger timeout; the server suite keeps the strict
// default. The derived bytes are identical across runtimes — only the speed differs.
const isBrowserRuntime = typeof self !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
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
            protectedSessionService.setDataKey(dataKeyBefore);

            const newPassword = "brandNewPass-123";
            const result = await getContext().init(() =>
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

            // The protected session opened with the old password is closed.
            expect(protectedSessionService.isProtectedSessionAvailable()).toBe(false);

            // The underlying data key is preserved across the re-encryption.
            const dataKeyAfter = (await passwordEncryptionService.getDataKey(
                newPassword
            )) as Uint8Array;
            expect(Array.from(dataKeyAfter)).toEqual(Array.from(dataKeyBefore));
        });

        it("lets one of two overlapping changes win and keeps what it stored usable", async () => {
            const current = "brandNewPass-123";
            const dataKeyBefore = (await passwordEncryptionService.getDataKey(current)) as Uint8Array;

            const results = await Promise.all([ "overlapA-1", "overlapB-2" ].map((newPassword) =>
                getContext().init(() => passwordService.changePassword(current, newPassword))
            ));

            expect(results.map((result) => result.success).sort()).toEqual([ false, true ]);
            expect(results.find((result) => !result.success)?.message).toBe(
                "The password was changed somewhere else at the same time. Enter the current password and try again."
            );
            const winner = results[0].success ? "overlapA-1" : "overlapB-2";
            const loser = results[0].success ? "overlapB-2" : "overlapA-1";

            expect(await passwordEncryptionService.verifyPassword(winner)).toBe(true);
            expect(await passwordEncryptionService.verifyPassword(loser)).toBe(false);
            const dataKeyAfter = (await passwordEncryptionService.getDataKey(winner)) as Uint8Array;
            expect(Array.from(dataKeyAfter)).toEqual(Array.from(dataKeyBefore));
        });
    });

    describe("resetPassword", () => {
        it("clears every password-related option and makes isPasswordSet false", () => {
            const result = getContext().init(() => passwordService.resetPassword());

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

            const result = await getContext().init(() => passwordService.setPassword(freshPassword));
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

        it("lets one of two overlapping first-time sets win and keeps what it stored usable", async () => {
            getContext().init(() => passwordService.resetPassword());

            const results = await Promise.allSettled([ "firstA-1", "firstB-2" ].map((password) =>
                getContext().init(() => passwordService.setPassword(password))
            ));

            expect(results.map((result) => result.status).sort()).toEqual([ "fulfilled", "rejected" ]);
            const winner = results[0].status === "fulfilled" ? "firstA-1" : "firstB-2";
            const loser = results[0].status === "fulfilled" ? "firstB-2" : "firstA-1";

            expect(await passwordEncryptionService.verifyPassword(winner)).toBe(true);
            expect(await passwordEncryptionService.verifyPassword(loser)).toBe(false);
            const dataKey = (await passwordEncryptionService.getDataKey(winner)) as Uint8Array;
            expect(dataKey).toBeInstanceOf(Uint8Array);
            expect(dataKey.length).toBe(16);
        });
    });
});
