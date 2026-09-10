import type { TotpValidateOptions } from "time2fa";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateKey, mockValidate } = vi.hoisted(() => ({
    mockGenerateKey: vi.fn<(opts: { issuer: string; user: string }) => { secret: string; url: string }>(),
    mockValidate: vi.fn<(args: TotpValidateOptions) => boolean>()
}));

vi.mock("time2fa", () => ({
    Totp: { generateKey: mockGenerateKey, validate: mockValidate }
}));

import type { OptionNames } from "@triliumnext/commons";
import { becca_loader, cls, options } from "@triliumnext/core";
import migrateDisableTotpWhenMfaWasTurnedOff from "@triliumnext/core/src/migrations/0239__disable_totp_when_mfa_was_turned_off";
import crypto from "crypto";

import recoveryCodes from "./encryption/recovery_codes.js";
import totpEncryption from "./encryption/totp_encryption.js";
import sql_init from "./sql_init.js";
import totp from "./totp.js";

const SECRET = "JBSWY3DPEHPK3PXP";
const SECRET_URL = `otpauth://totp/Trilium:host?issuer=Trilium&secret=${SECRET}`;

describe("totp", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateKey.mockReturnValue({ secret: SECRET, url: SECRET_URL });
        mockValidate.mockReturnValue(true);
    });

    it("isTotpEnabled requires totp method + secret set", () => {
        // method is totp but no secret yet
        cls.init(() => {
            totpEncryption.resetTotpSecret();
            options.setOption("mfaMethod", "totp");
        });
        expect(totp.isTotpEnabled()).toBe(false);

        // secret set, but method is oauth
        cls.init(() => {
            options.setOption("mfaMethod", "oauth");
            totp.setSecret(SECRET);
        });
        expect(totp.isTotpEnabled()).toBe(false);

        // method totp + secret set
        cls.init(() => {
            options.setOption("mfaMethod", "totp");
        });
        expect(totp.isTotpEnabled()).toBe(true);
    });

    /**
     * Regression cover for #10576. Up to v0.103.x, `mfaEnabled` was the master switch and
     * {@link totp.isTotpEnabled} read it alongside the method and the secret:
     *
     *     mfaEnabled === "true" && mfaMethod === "totp" && isTotpSecretSet()
     *
     * v0.104.0 removed the enable checkbox (69022d2cb8), making enrollment itself the switch, and
     * dropped the first term. Disabling MFA on v0.103 never cleared the secret — it only set the flag
     * — so an upgraded install can carry a live secret plus `mfaMethod` at its "totp" default. With the
     * flag no longer read, the two surviving terms are both true and TOTP silently switches back on,
     * locking the owner out of the web UI behind a prompt they deliberately turned off.
     *
     * These two tests bracket that: the upgrade must preserve whichever intent the user had recorded.
     */
    describe("upgrading from a v0.103.x install that used mfaEnabled", () => {
        /** Recreates the on-disk state such an install is upgraded with. */
        function seedLegacyInstall(mfaEnabled: "true" | "false") {
            cls.init(() => {
                // `mfaEnabled` was dropped from OptionDefinitions in v0.104.0, so the name has to be cast
                // back in. setOption creates the row when it is missing and writes through becca, leaving
                // it visible whether the migration reads the cache or the table directly.
                options.setOption("mfaEnabled" as OptionNames, mfaEnabled);
                // Both installs kept a usable secret: v0.103's disable path cleared neither.
                totp.setSecret(SECRET);
                // The default, and what any install that enrolled TOTP carries.
                options.setOption("mfaMethod", "totp");
            });
        }

        /**
         * Runs the upgrade the way startup does: the migration first, then becca. The migration works in
         * raw SQL because migrations run before the options cache exists, so the reload is what makes its
         * writes visible to {@link totp.isTotpEnabled} — exactly as the real boot sequence does.
         */
        function upgradeToCurrentVersion() {
            cls.init(() => {
                migrateDisableTotpWhenMfaWasTurnedOff();
                becca_loader.load();
            });
        }

        it("keeps prompting when MFA was left enabled", () => {
            seedLegacyInstall("true");

            upgradeToCurrentVersion();

            expect(totp.isTotpEnabled()).toBe(true);
        });

        it("does not prompt when MFA was explicitly disabled", () => {
            seedLegacyInstall("false");

            upgradeToCurrentVersion();

            // The owner turned MFA off on v0.103 and was never prompted again. An upgrade must not
            // resurrect it from the secret their disable left behind.
            expect(totp.isTotpEnabled()).toBe(false);
        });
    });

    it("generateSecret returns a fresh secret and otpauth URL without persisting it", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
        });
        let result: { success: boolean; message?: string; url?: string } | undefined;
        cls.init(() => {
            result = totp.generateSecret("host");
        });
        expect(result?.success).toBe(true);
        expect(result?.message).toBe(SECRET);
        expect(result?.url).toBe(SECRET_URL);
        expect(mockGenerateKey).toHaveBeenCalledWith({ issuer: "Trilium", user: "host" });
        // Generation alone must NOT persist the secret: it only becomes active after the user
        // confirms a code for it, which is what prevents an accidental lockout.
        expect(totp.checkForTotpSecret()).toBe(false);
    });

    it("setSecret persists a secret so it can be retrieved", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
            totp.setSecret(SECRET);
        });
        expect(totp.checkForTotpSecret()).toBe(true);
        expect(totp.getTotpSecret()).toBe(SECRET);
    });

    it("generateSecret returns failure when secret generation throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        // Error instance -> the error's message is surfaced
        mockGenerateKey.mockImplementation(() => {
            throw new Error("gen failed");
        });
        let result: { success: boolean; message?: string } | undefined;
        cls.init(() => {
            result = totp.generateSecret();
        });
        expect(result?.success).toBe(false);
        expect(result?.message).toBe("gen failed");

        // non-Error throw -> falls back to a generic message
        mockGenerateKey.mockImplementation(() => {
            throw "string failure";
        });
        cls.init(() => {
            result = totp.generateSecret();
        });
        expect(result?.success).toBe(false);
        expect(result?.message).toBeTruthy();

        errorSpy.mockRestore();
    });

    it("validateTOTPForSecret validates against a supplied secret without a stored one", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
        });

        mockValidate.mockReturnValue(true);
        expect(totp.validateTOTPForSecret(SECRET, "000000")).toBe(true);
        expect(mockValidate).toHaveBeenCalledWith({ passcode: "000000", secret: SECRET, drift: 1 });

        mockValidate.mockReturnValue(false);
        expect(totp.validateTOTPForSecret(SECRET, "000000")).toBe(false);

        // An empty secret short-circuits without invoking the validator.
        mockValidate.mockClear();
        expect(totp.validateTOTPForSecret("", "000000")).toBe(false);
        expect(mockValidate).not.toHaveBeenCalled();
    });

    it("validateTOTP returns false when no secret is set", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
        });
        expect(totp.validateTOTP("123456")).toBe(false);
        expect(mockValidate).not.toHaveBeenCalled();
    });

    it("validateTOTP delegates to Totp.validate when a secret is set", () => {
        cls.init(() => {
            totp.setSecret(SECRET);
        });

        mockValidate.mockReturnValue(true);
        expect(totp.validateTOTP("000000")).toBe(true);

        mockValidate.mockReturnValue(false);
        expect(totp.validateTOTP("000000")).toBe(false);
    });

    it("validateTOTP returns false when Totp.validate throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        cls.init(() => {
            totp.setSecret(SECRET);
        });
        mockValidate.mockImplementation(() => {
            throw new Error("invalid");
        });
        expect(totp.validateTOTP("bad")).toBe(false);
        errorSpy.mockRestore();
    });

    /**
     * Regression cover for #11439. `time2fa` defaults to zero drift, so up to v0.105.0 Trilium
     * matched a passcode only against the single 30-second window the request landed in. Enrollment
     * and login both rejected codes that Google Authenticator and `oathtool --totp -b` agreed were
     * correct, whenever the window rolled over between the authenticator showing a code and the
     * server checking it. RFC 6238 section 5.2 recommends one step of tolerance either side.
     *
     * These tests run against the real library, which the rest of the file mocks, and against
     * passcodes computed independently of it, so they cover the acceptance window rather than the
     * argument passed.
     */
    describe("clock drift tolerance", () => {
        // A 10-byte secret, base32-encoded: the shape Totp.generateKey issues and the only size the
        // library accepts.
        const REAL_SECRET = "KG2GFNXR22IVIVTG";
        const WINDOW_SECONDS = 30;
        // Mid-window, so shifting by one step lands squarely in a neighbouring window instead of
        // depending on where the boundary happens to fall.
        const SERVER_NOW = 1789038000 + WINDOW_SECONDS / 2;

        beforeEach(async () => {
            const { Totp } = await vi.importActual<typeof import("time2fa")>("time2fa");
            mockValidate.mockImplementation((args) => Totp.validate(args));
            vi.useFakeTimers();
            vi.setSystemTime(SERVER_NOW * 1000);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("accepts the neighbouring windows and rejects anything further out", () => {
            for (const offset of [ -WINDOW_SECONDS, 0, WINDOW_SECONDS ]) {
                const passcode = authenticatorCodeAt(REAL_SECRET, SERVER_NOW + offset);
                expect(totp.validateTOTPForSecret(REAL_SECRET, passcode)).toBe(true);
            }

            for (const offset of [ -2 * WINDOW_SECONDS, 2 * WINDOW_SECONDS ]) {
                const passcode = authenticatorCodeAt(REAL_SECRET, SERVER_NOW + offset);
                expect(totp.validateTOTPForSecret(REAL_SECRET, passcode)).toBe(false);
            }
        });

        it("applies the same tolerance at login", () => {
            cls.init(() => {
                totp.setSecret(REAL_SECRET);
            });

            const passcode = authenticatorCodeAt(REAL_SECRET, SERVER_NOW + WINDOW_SECONDS);
            expect(totp.validateTOTP(passcode)).toBe(true);
        });
    });

    it("resetTotp clears the secret and recovery codes", () => {
        cls.init(() => {
            options.setOption("mfaMethod", "totp");
            totp.setSecret(SECRET);
            recoveryCodes.setRecoveryCodes("AAAAAAAAAAAAAAAAAAAAAA==,BBBBBBBBBBBBBBBBBBBBBB==");
        });
        expect(totp.checkForTotpSecret()).toBe(true);
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(true);

        cls.init(() => {
            totp.resetTotp();
        });

        expect(totp.checkForTotpSecret()).toBe(false);
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(false);
    });
});

/**
 * The RFC 6238 passcode for `secret` at `epochSeconds`, computed independently of `time2fa` — the
 * stand-in for what Google Authenticator or `oathtool --totp -b <secret>` shows at that moment.
 */
function authenticatorCodeAt(secret: string, epochSeconds: number): string {
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(Math.floor(epochSeconds / 30), 4);

    const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const truncated = digest.readUInt32BE(offset) & 0x7fffffff;

    return (truncated % 1_000_000).toString().padStart(6, "0");
}

function decodeBase32(secret: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes: number[] = [];
    let value = 0;
    let bits = 0;

    for (const char of secret.replace(/=+$/, "").toUpperCase()) {
        value = (value << 5) | alphabet.indexOf(char);
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}
