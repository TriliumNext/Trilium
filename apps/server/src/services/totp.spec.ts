import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateKey, mockValidate } = vi.hoisted(() => ({
    mockGenerateKey: vi.fn<(opts: { issuer: string; user: string }) => { secret: string; url: string }>(),
    mockValidate: vi.fn<(args: { passcode: string; secret: string }) => boolean>()
}));

vi.mock("time2fa", () => ({
    Totp: { generateKey: mockGenerateKey, validate: mockValidate }
}));

import { cls, options } from "@triliumnext/core";

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
        expect(mockValidate).toHaveBeenCalledWith({ passcode: "000000", secret: SECRET });

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
