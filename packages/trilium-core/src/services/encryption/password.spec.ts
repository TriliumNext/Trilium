import { describe, expect, it, vi } from "vitest";

import events from "../events.js";
import options from "../options.js";
import { getContext } from "../context.js";
import protectedSessionService from "../protected_session.js";
import { encodeBase64, encodeUtf8 } from "../utils/binary.js";
import passwordEncryptionService from "./password_encryption.js";
import passwordService from "./password.js";
import scryptService from "./scrypt.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore
// with an in-memory copy of the fixture DB, which already has a password set
// ("demo1234"). Each spec file runs in its own vitest fork (pool: "forks"), so
// the mutations below isolate to this file. The `it()`s nonetheless share the
// single fixture DB, so they're ordered to flow from "password set" through to
// the destructive reset/re-set at the end.
const FIXTURE_PASSWORD = "demo1234";

// scrypt (N=16384) runs in pure JS (@noble/hashes) under the browser provider, which is
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

        it("refuses while the data key cannot be read, and changes nothing", async () => {
            vi.spyOn(passwordEncryptionService, "getDataKey").mockResolvedValueOnce(false);
            const before = passwordOptions();

            const result = await getContext().init(() =>
                passwordService.changePassword("brandNewPass-123", "thirdPass-789")
            );

            expect(result).toMatchObject({ success: false, code: "data-key-unreadable" });
            expect(passwordOptions()).toEqual(before);
            expect(await passwordEncryptionService.verifyPassword("brandNewPass-123")).toBe(true);
        });

        it("refuses a data key planted for the recovery path, as getDataKey does", async () => {
            const stored = options.getOption("encryptedDataKey");
            try {
                for (const length of [ 12, 20 ]) {
                    const planted = encodeBase64(Uint8Array.from({ length }, (_, i) => i + 1));
                    getContext().init(() => options.setOption("encryptedDataKey", planted));

                    expect(
                        await passwordEncryptionService.getDataKey("brandNewPass-123"),
                        String(length)
                    ).toBe(false);
                    const result = await getContext().init(() =>
                        passwordService.changePassword("brandNewPass-123", "thirdPass-789"));
                    expect(result.code).toBe("data-key-unreadable");
                    expect(options.getOption("encryptedDataKey")).toBe(planted);
                }
            } finally {
                getContext().init(() => options.setOption("encryptedDataKey", stored));
            }
        });

        it("keeps the old password and its key when a change fails half way", async () => {
            const getScryptHash = scryptService.getScryptHash;
            for (const failingCall of [ 1, 2 ]) {
                let call = 0;
                vi.spyOn(scryptService, "getScryptHash")
                    .mockImplementation(async (password, salt) => {
                        call++;
                        if (call === failingCall) {
                            throw new Error("scrypt failed");
                        }
                        return getScryptHash(password, salt);
                    });

                await expect(getContext().init(() =>
                    passwordService.changePassword("brandNewPass-123", "thirdPass-789")
                )).rejects.toThrow("scrypt failed");
                vi.restoreAllMocks();

                expect(await passwordEncryptionService.verifyPassword("brandNewPass-123"))
                    .toBe(true);
                expect(await passwordEncryptionService.getDataKey("brandNewPass-123"))
                    .toBeInstanceOf(Uint8Array);
            }
        });

        it("opens a data key of 24 bytes, as set before 2026-04-12, and one of 16", async () => {
            const dataKey = (await passwordEncryptionService.getDataKey(
                "brandNewPass-123"
            )) as Uint8Array;
            try {
                for (const key of [
                    encodeUtf8(encodeBase64(Uint8Array.from({ length: 16 }, (_, i) => 200 - i))),
                    Uint8Array.from({ length: 16 }, (_, i) => i * 3)
                ]) {
                    await getContext().init(() =>
                        passwordEncryptionService.setDataKey("brandNewPass-123", key));

                    const opened = await passwordEncryptionService.getDataKey("brandNewPass-123");
                    expect(Array.from(opened as Uint8Array)).toEqual(Array.from(key));
                }
            } finally {
                await getContext().init(() =>
                    passwordEncryptionService.setDataKey("brandNewPass-123", dataKey));
            }
        });

        it("ends the protected session only when sync brings a different password hash", () => {
            protectedSessionService.setDataKey(Uint8Array.from([ 1, 2, 3 ]));
            const stored = options.getOption("passwordVerificationHash");

            getContext().init(() => events.emit(events.ENTITY_CHANGE_SYNCED, {
                entityName: "options",
                entityRow: { name: "passwordVerificationHash", value: stored }
            }));
            expect(protectedSessionService.isProtectedSessionAvailable()).toBe(true);

            getContext().init(() => events.emit(events.ENTITY_CHANGE_SYNCED, {
                entityName: "options",
                entityRow: { name: "passwordVerificationHash", value: "a-peer's-hash" }
            }));
            expect(protectedSessionService.isProtectedSessionAvailable()).toBe(false);

            // Written back as sync would write it, now that the listener knows the peer's hash.
            getContext().init(() => events.emit(events.ENTITY_CHANGE_SYNCED, {
                entityName: "options",
                entityRow: { name: "passwordVerificationHash", value: stored }
            }));
        });
    });

    describe("setPassword where only the row of the hash was emptied", () => {
        it("restores only the password that opens the data key, and keeps the key", async () => {
            const encryptedDataKey = options.getOption("encryptedDataKey");
            getContext().init(() => options.setOption("passwordVerificationHash", ""));

            const refused = await getContext().init(() =>
                passwordService.setPassword("a-visitor's-password"));
            expect(refused).toMatchObject({ success: false, code: "password-not-restored" });
            expect(passwordService.isPasswordSet()).toBe(false);
            expect(options.getOption("encryptedDataKey")).toBe(encryptedDataKey);

            const restored = await getContext().init(() =>
                passwordService.setPassword("brandNewPass-123"));
            expect(restored.success).toBe(true);
            expect(await passwordEncryptionService.verifyPassword("brandNewPass-123")).toBe(true);
            expect(options.getOption("encryptedDataKey")).toBe(encryptedDataKey);
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
    });
});

/** The four stored password options. */
function passwordOptions() {
    return ([
        "passwordVerificationSalt",
        "passwordDerivedKeySalt",
        "passwordVerificationHash",
        "encryptedDataKey"
    ] as const)
        .map((name) => options.getOption(name));
}
