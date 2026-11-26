import { cls, options } from "@triliumnext/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recoveryCodeService from "./encryption/recovery_codes.js";
import * as secondFactor from "./second_factor.js";
import { resetSetupWrongCodes, setupSecondFactor } from "./setup_second_factor.js";
import totp from "./totp.js";

const RECOVERY_CODE = "AAAAAAAAAAAAAAAAAAAAAA==";

beforeEach(() => resetSetupWrongCodes());
afterEach(() => {
    vi.restoreAllMocks();
    cls.init(() => options.setOption("totpWrongCodeCount", ""));
});

/** A factor that the wizard can check. */
function enableReadableFactor() {
    vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
    vi.spyOn(totp, "getTotpSecret").mockReturnValue("JBSWY3DPEHPK3PXP");
}

describe("the second factor the setup wizard asks for", () => {
    it("is required exactly when a factor is asked for", () => {
        const enabled = vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
        expect(setupSecondFactor.isRequired()).toBe(true);

        enabled.mockReturnValue(false);
        expect(setupSecondFactor.isRequired()).toBe(false);
    });

    it("accepts a passcode from the authenticator without looking at the recovery codes", () => {
        enableReadableFactor();
        const validate = vi.spyOn(totp, "validateTOTP").mockReturnValue(true);
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode").mockReturnValue(false);

        expect(setupSecondFactor.verify("123456")).toBe(true);
        expect(validate).toHaveBeenCalledWith("123456");
        expect(matches).not.toHaveBeenCalled();
    });

    it("matches a recovery code, without spending it", () => {
        enableReadableFactor();
        const validate = vi.spyOn(totp, "validateTOTP").mockReturnValue(false);
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode").mockReturnValue(true);
        const verify = vi.spyOn(recoveryCodeService, "verifyRecoveryCode");

        expect(setupSecondFactor.verify(RECOVERY_CODE)).toBe(true);
        expect(matches).toHaveBeenCalledWith(RECOVERY_CODE);
        expect(verify).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it("refuses an empty answer before checking anything", () => {
        const validate = vi.spyOn(totp, "validateTOTP");
        const matches = vi.spyOn(recoveryCodeService, "matchesRecoveryCode");

        expect(setupSecondFactor.verify("")).toBe(false);
        expect(validate).not.toHaveBeenCalled();
        expect(matches).not.toHaveBeenCalled();
    });

    it("refuses every answer for a factor it cannot read, and never the password alone", () => {
        vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
        vi.spyOn(totp, "getTotpSecret").mockReturnValue(null);

        expect(setupSecondFactor.isRequired()).toBe(true);
        expect(setupSecondFactor.verify("123456")).toBe(false);
    });

    it("takes the words of the variable in place of a code once it removed the factor", () => {
        vi.spyOn(secondFactor, "getSecondFactorCheck").mockReturnValue("words");
        vi.spyOn(secondFactor, "matchesResetWords")
            .mockImplementation((answer) => answer === "the owner's long words");

        expect(setupSecondFactor.verify("123456")).toBe(false);
        expect(setupSecondFactor.verify("the owner's long words")).toBe(true);
    });

    it("counts wrong codes on in memory, and makes a code wait after five", () => {
        enableReadableFactor();
        const validate = vi.spyOn(totp, "validateTOTP").mockReturnValue(false);

        for (let i = 0; i < 5; i++) {
            expect(setupSecondFactor.verify("000000")).toBe(false);
        }
        validate.mockReturnValue(true);
        expect(setupSecondFactor.verify("123456")).toBe(false);
        // Nothing is written, since the wizard runs on a database that it must not change.
        expect(options.getOptionOrNull("totpWrongCodeCount")).toBe("");
    });
});
