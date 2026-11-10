import { afterEach, describe, expect, it, vi } from "vitest";

import recoveryCodeService from "./encryption/recovery_codes.js";
import { setupSecondFactor } from "./setup_second_factor.js";
import totp from "./totp.js";

afterEach(() => vi.restoreAllMocks());

describe("the second factor the setup wizard asks for", () => {
    it("is required exactly when TOTP is enabled", () => {
        const enabled = vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
        expect(setupSecondFactor.isRequired()).toBe(true);

        enabled.mockReturnValue(false);
        expect(setupSecondFactor.isRequired()).toBe(false);
    });

    it("accepts a passcode from the authenticator without looking at the recovery codes", () => {
        const validate = vi.spyOn(totp, "validateTOTP").mockReturnValue(true);
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode").mockReturnValue(false);

        expect(setupSecondFactor.verify("123456")).toBe(true);
        expect(validate).toHaveBeenCalledWith("123456");
        expect(matches).not.toHaveBeenCalled();
    });

    it("falls back to matching a recovery code, without spending it", () => {
        vi.spyOn(totp, "validateTOTP").mockReturnValue(false);
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode").mockReturnValue(true);
        const verify = vi.spyOn(recoveryCodeService, "verifyRecoveryCode");

        expect(setupSecondFactor.verify("a-recovery-code")).toBe(true);
        expect(matches).toHaveBeenCalledWith("a-recovery-code");
        expect(verify).not.toHaveBeenCalled();

        matches.mockReturnValue(false);
        expect(setupSecondFactor.verify("wrong")).toBe(false);
    });

    it("refuses an empty answer before checking anything", () => {
        const validate = vi.spyOn(totp, "validateTOTP");
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode");

        expect(setupSecondFactor.verify("")).toBe(false);
        expect(validate).not.toHaveBeenCalled();
        expect(matches).not.toHaveBeenCalled();
    });
});
