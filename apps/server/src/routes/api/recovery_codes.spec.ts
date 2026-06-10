import { cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import recoveryCodesRoute from "./recovery_codes.js";

describe("Recovery codes API", () => {
    it("reports no keys before any are set", () => {
        // Runs first within this fork's fresh DB copy.
        const result = recoveryCodesRoute.checkForRecoveryKeys();
        expect(result).toEqual({ success: true, keysExist: false });
        expect(recoveryCodesRoute.getUsedRecoveryCodes()).toEqual([]);
    });

    it("generates codes, then verifies and marks one as used", () => {
        const generated = cls.init(() => recoveryCodesRoute.generateRecoveryCodes());
        expect(generated.success).toBe(true);
        expect(generated.recoveryCodes).toHaveLength(8);

        expect(recoveryCodesRoute.checkForRecoveryKeys()).toEqual({ success: true, keysExist: true });

        const guess = generated.recoveryCodes[0];
        const verifyReq = { body: { recovery_code_guess: guess } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(verifyReq))).toEqual({ success: true });

        // A wrong guess fails.
        const wrongReq = { body: { recovery_code_guess: "not-a-valid-code" } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(wrongReq))).toEqual({ success: false });

        const used = recoveryCodesRoute.getUsedRecoveryCodes() as { success: boolean; usedRecoveryCodes: string[] };
        expect(used.success).toBe(true);
        // The used code is replaced by an ISO-ish timestamp; the rest stay as indices.
        expect(used.usedRecoveryCodes.some(c => /T/.test(c))).toBe(true);
    });

    it("sets recovery codes from an explicit list", () => {
        const codes = Array.from({ length: 3 }, (_, i) => `code-${i}`);
        const req = { body: { recoveryCodes: codes } } as unknown as Request;
        const result = cls.init(() => recoveryCodesRoute.setRecoveryCodes(req));
        expect(result.message).toBe("Recovery codes set!");
    });
});
