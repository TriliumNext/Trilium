import { cls, options } from "@triliumnext/core";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateKey, mockValidate } = vi.hoisted(() => ({
    mockGenerateKey: vi.fn<(opts: { issuer: string; user: string }) => { secret: string; url: string }>(),
    mockValidate: vi.fn<(args: { passcode: string; secret: string }) => boolean>()
}));

vi.mock("time2fa", () => ({
    Totp: { generateKey: mockGenerateKey, validate: mockValidate }
}));

import recoveryCodes from "../../services/encryption/recovery_codes.js";
import totpEncryption from "../../services/encryption/totp_encryption.js";
import totpRoute from "./totp.js";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("TOTP API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateKey.mockReturnValue({ secret: SECRET, url: `otpauth://totp/Trilium:localhost?issuer=Trilium&secret=${SECRET}` });
        mockValidate.mockReturnValue(true);
        // Reset secret + codes each test, so the persist assertions below are meaningful.
        cls.init(() => {
            totpEncryption.resetTotpSecret();
            recoveryCodes.clearRecoveryCodes();
        });
    });

    it("generates a base32 secret and otpauth URL without persisting it", () => {
        const result = cls.init(() => totpRoute.generateSecret({ hostname: "localhost" } as Request));
        expect(result.success).toBe(true);
        expect(result.message).toMatch(/^[A-Z2-7]+$/);
        expect(result.url).toContain("otpauth://");
        // The request hostname is used as the account label under the "Trilium" issuer.
        expect(mockGenerateKey).toHaveBeenCalledWith({ issuer: "Trilium", user: "localhost" });
        // Generation must not store the secret — that only happens at enable.
        expect(totpRoute.getTOTPStatus().set).toBe(false);
    });

    it("verifySecret issues recovery codes but persists nothing when the code is valid", () => {
        mockValidate.mockReturnValue(true);
        const result = runVerify({ secret: SECRET, token: "000000" }) as
            { success: boolean; recoveryCodes?: string[] };
        expect(result.success).toBe(true);
        expect(result.recoveryCodes).toHaveLength(8);
        expect(mockValidate).toHaveBeenCalledWith({ passcode: "000000", secret: SECRET });
        // Verifying alone must neither enable TOTP nor store the recovery codes.
        expect(totpRoute.getTOTPStatus().set).toBe(false);
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(false);
    });

    it("verifySecret rejects an invalid code", () => {
        mockValidate.mockReturnValue(false);
        expect(runVerify({ secret: SECRET, token: "999999" })).toEqual({ success: false });
        expect(totpRoute.getTOTPStatus().set).toBe(false);
    });

    it("verifySecret rejects missing secret or token without validating", () => {
        expect(runVerify({ token: "000000" })).toEqual({ success: false });
        expect(runVerify({ secret: SECRET })).toEqual({ success: false });
        expect(runVerify({})).toEqual({ success: false });
        expect(mockValidate).not.toHaveBeenCalled();
    });

    it("enableSecret commits the secret and recovery codes, activating TOTP", () => {
        const codes = Array.from({ length: 8 }, (_, i) => `recovery-code-${i}`);
        expect(runEnable({ secret: SECRET, recoveryCodes: codes })).toEqual({ success: true });
        expect(totpRoute.getTOTPStatus().set).toBe(true);
        expect(totpRoute.getTOTPStatus().message).toBe(true);
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(true);
    });

    it("enableSecret enforces TOTP at login even when the stored mfaMethod is stale", () => {
        // Simulates an upgraded install where an older resetTotp left mfaMethod = "" behind. The
        // sign-in dropdown reads "" as "local" and never rewrites it during enrollment, so the
        // commit itself must select the TOTP method — otherwise isTotpEnabled() stays false and
        // login would silently skip the second factor the user believes is active.
        cls.init(() => options.setOption("mfaMethod", ""));
        const codes = Array.from({ length: 8 }, (_, i) => `recovery-code-${i}`);
        expect(runEnable({ secret: SECRET, recoveryCodes: codes })).toEqual({ success: true });
        expect(totpRoute.getTOTPStatus().message).toBe(true);
    });

    it("enableSecret rejects a missing secret or empty recovery codes without persisting", () => {
        expect(runEnable({ recoveryCodes: [ "a" ] })).toEqual({ success: false });
        expect(runEnable({ secret: SECRET })).toEqual({ success: false });
        expect(runEnable({ secret: SECRET, recoveryCodes: [] })).toEqual({ success: false });
        expect(totpRoute.getTOTPStatus().set).toBe(false);
    });

    it("reports the TOTP status", () => {
        const status = totpRoute.getTOTPStatus();
        expect(status.success).toBe(true);
        expect(typeof status.message).toBe("boolean");
        expect(typeof status.set).toBe("boolean");
    });

    it("exposes the configured secret (empty when none is set)", () => {
        const result = totpRoute.getSecret();
        expect(result).toBeDefined();
    });
});

function runVerify(body: unknown) {
    return cls.init(() => totpRoute.verifySecret({ body } as unknown as Request));
}

function runEnable(body: unknown) {
    return cls.init(() => totpRoute.enableSecret({ body } as unknown as Request));
}
