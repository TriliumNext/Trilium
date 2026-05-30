import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateSecret, mockValidate } = vi.hoisted(() => ({
    mockGenerateSecret: vi.fn<() => string>(),
    mockValidate: vi.fn<(args: { passcode: string; secret: string }) => boolean>()
}));

vi.mock("time2fa", () => ({
    generateSecret: mockGenerateSecret,
    Totp: { validate: mockValidate }
}));

import { cls, options } from "@triliumnext/core";

import totpEncryption from "./encryption/totp_encryption.js";
import sql_init from "./sql_init.js";
import totp from "./totp.js";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("totp", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateSecret.mockReturnValue(SECRET);
        mockValidate.mockReturnValue(true);
    });

    it("isTotpEnabled requires mfaEnabled+totp method+secret set", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
            options.setOption("mfaEnabled", "false");
            options.setOption("mfaMethod", "totp");
        });
        expect(totp.isTotpEnabled()).toBe(false);

        cls.init(() => {
            options.setOption("mfaEnabled", "true");
            options.setOption("mfaMethod", "oauth");
        });
        expect(totp.isTotpEnabled()).toBe(false);

        // method is totp + enabled, but no secret yet
        cls.init(() => {
            options.setOption("mfaMethod", "totp");
        });
        expect(totp.isTotpEnabled()).toBe(false);

        // now set a secret as well
        cls.init(() => {
            totp.createSecret();
        });
        expect(totp.isTotpEnabled()).toBe(true);
    });

    it("createSecret stores the generated secret on success", () => {
        cls.init(() => {
            totpEncryption.resetTotpSecret();
        });
        let result: { success: boolean; message?: string } | undefined;
        cls.init(() => {
            result = totp.createSecret();
        });
        expect(result?.success).toBe(true);
        expect(result?.message).toBe(SECRET);
        expect(totp.checkForTotpSecret()).toBe(true);
        expect(totp.getTotpSecret()).not.toBeNull();
    });

    it("createSecret returns failure when secret generation throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        // Error instance -> the error's message is surfaced
        mockGenerateSecret.mockImplementation(() => {
            throw new Error("gen failed");
        });
        let result: { success: boolean; message?: string } | undefined;
        cls.init(() => {
            result = totp.createSecret();
        });
        expect(result?.success).toBe(false);
        expect(result?.message).toBe("gen failed");

        // non-Error throw -> falls back to a generic message
        mockGenerateSecret.mockImplementation(() => {
            throw "string failure";
        });
        cls.init(() => {
            result = totp.createSecret();
        });
        expect(result?.success).toBe(false);
        expect(result?.message).toBeTruthy();

        errorSpy.mockRestore();
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
            totp.createSecret();
        });

        mockValidate.mockReturnValue(true);
        expect(totp.validateTOTP("000000")).toBe(true);

        mockValidate.mockReturnValue(false);
        expect(totp.validateTOTP("000000")).toBe(false);
    });

    it("validateTOTP returns false when Totp.validate throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        cls.init(() => {
            totp.createSecret();
        });
        mockValidate.mockImplementation(() => {
            throw new Error("invalid");
        });
        expect(totp.validateTOTP("bad")).toBe(false);
        errorSpy.mockRestore();
    });

    it("resetTotp clears the secret and disables MFA", () => {
        cls.init(() => {
            options.setOption("mfaEnabled", "true");
            options.setOption("mfaMethod", "totp");
            totp.createSecret();
        });
        expect(totp.checkForTotpSecret()).toBe(true);

        cls.init(() => {
            totp.resetTotp();
        });

        expect(totp.checkForTotpSecret()).toBe(false);
        expect(options.getOptionOrNull("mfaEnabled")).toBe("false");
        expect(options.getOptionOrNull("mfaMethod")).toBe("");
    });
});
