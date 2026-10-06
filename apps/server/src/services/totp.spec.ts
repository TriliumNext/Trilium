import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateKey, mockValidate } = vi.hoisted(() => ({
    mockGenerateKey: vi.fn<(opts: { issuer: string; user: string }) => { secret: string; url: string }>(),
    mockValidate: vi.fn<typeof import("time2fa").Hotp.validate>()
}));

vi.mock("time2fa", async (importOriginal) => ({
    ...await importOriginal<typeof import("time2fa")>(),
    Totp: { generateKey: mockGenerateKey },
    Hotp: { validate: mockValidate }
}));

import type { OptionNames } from "@triliumnext/commons";
import { becca_loader, cls, options } from "@triliumnext/core";
import migrateDisableTotpWhenMfaWasTurnedOff from "@triliumnext/core/src/migrations/0239__disable_totp_when_mfa_was_turned_off";

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
        expect(mockValidate).toHaveBeenCalledWith(
            { passcode: "000000", secret: SECRET, counter: expect.any(Number) }, expect.anything());

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

    it("validateTOTP delegates to Hotp.validate when a secret is set", () => {
        cls.init(() => {
            totp.setSecret(SECRET);
        });

        mockValidate.mockReturnValue(true);
        expect(totp.validateTOTP("000000")).toBe(true);

        mockValidate.mockReturnValue(false);
        expect(totp.validateTOTP("000000")).toBe(false);
    });

    it("validateTOTP returns false when Hotp.validate throws", () => {
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

    it("verifyTOTP accepts a code only once, while validateTOTP records nothing", async () => {
        const codeFor = await useRealCodes();
        const verify = (counter: number) => cls.init(() => totp.verifyTOTP(codeFor(counter)));
        vi.useFakeTimers({ toFake: [ "Date" ] });
        try {
            cls.init(() => totp.setSecret(SECRET));
            vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
            const step = Math.floor(Date.now() / 1000 / 30);

            expect(cls.init(() => totp.validateTOTP(codeFor(step)))).toBe(true);
            expect(verify(step)).toBe(true);
            expect(verify(step)).toBe(false);

            vi.setSystemTime(new Date("2026-01-01T00:00:40Z"));
            expect(verify(step + 1)).toBe(true);

            // At step + 2 the window reaches back to step + 1, whose code is already used.
            vi.setSystemTime(new Date("2026-01-01T00:01:10Z"));
            expect(verify(step + 1)).toBe(false);
            // A code from an authenticator one step ahead passes, and after it nothing older does.
            expect(verify(step + 3)).toBe(true);
            expect(verify(step + 2)).toBe(false);

            // Enrolling a secret clears the recorded step.
            cls.init(() => totp.setSecret(SECRET));
            expect(verify(step + 2)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("verifyTOTP only tries steps after the last used one", () => {
        // Six-digit codes can repeat between steps; a code that matches every step stands in.
        mockValidate.mockReturnValue(true);
        vi.useFakeTimers({ toFake: [ "Date" ] });
        try {
            cls.init(() => totp.setSecret(SECRET));
            vi.setSystemTime(new Date("2026-01-01T00:00:40Z"));
            const step = Math.floor(Date.now() / 1000 / 30);
            const verify = () => cls.init(() => totp.verifyTOTP("000000"));

            for (const expected of [ step - 1, step, step + 1 ]) {
                expect(verify()).toBe(true);
                expect(options.getOption("totpLastUsedStep")).toBe(String(expected));
            }
            expect(verify()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("enrollment accepts a step either side, the wizard only the current one", async () => {
        const codeFor = await useRealCodes();
        vi.useFakeTimers({ toFake: [ "Date" ] });
        try {
            cls.init(() => totp.setSecret(SECRET));
            vi.setSystemTime(new Date("2026-01-01T00:00:40Z"));
            const step = Math.floor(Date.now() / 1000 / 30);

            expect(totp.validateTOTPForSecret(SECRET, codeFor(step - 1))).toBe(true);
            expect(totp.validateTOTPForSecret(SECRET, codeFor(step + 1))).toBe(true);
            expect(totp.validateTOTPForSecret(SECRET, codeFor(step - 2))).toBe(false);
            expect(totp.validateTOTPForSecret(SECRET, codeFor(step + 2))).toBe(false);

            expect(cls.init(() => totp.validateTOTP(codeFor(step)))).toBe(true);
            expect(cls.init(() => totp.validateTOTP(codeFor(step - 1)))).toBe(false);
            expect(cls.init(() => totp.validateTOTP(codeFor(step + 1)))).toBe(false);
        } finally {
            vi.useRealTimers();
        }
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

/** Routes the mocked `Hotp.validate` to the real one and returns the real code for a time step. */
async function useRealCodes() {
    const actual = await vi.importActual<typeof import("time2fa")>("time2fa");
    const config = actual.generateConfig();
    mockValidate.mockImplementation(actual.Hotp.validate.bind(actual.Hotp));

    return (counter: number) => actual.Hotp.generatePasscode({ secret: SECRET, counter }, config);
}
