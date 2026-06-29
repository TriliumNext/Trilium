import { cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import recoveryCodesService from "../../services/encryption/recovery_codes.js";
import totpService from "../../services/totp.js";
import recoveryCodesRoute from "./recovery_codes.js";

describe("Recovery codes API", () => {
    it("reports no keys before any are set", () => {
        // Runs first within this fork's fresh DB copy.
        const result = recoveryCodesRoute.checkForRecoveryKeys();
        expect(result).toEqual({ success: true, keysExist: false });
        expect(recoveryCodesRoute.getUsedRecoveryCodes()).toEqual([]);
    });

    it("verifies a code and marks it as used", () => {
        // Recovery codes are issued during TOTP enrollment, not by this route, so seed them via the
        // service to exercise the read/verify endpoints.
        const codes = cls.init(() => {
            const generated = recoveryCodesService.createRecoveryCodes();
            recoveryCodesService.setRecoveryCodes(generated.join(","));
            return generated;
        });
        expect(codes).toHaveLength(8);

        expect(recoveryCodesRoute.checkForRecoveryKeys()).toEqual({ success: true, keysExist: true });

        const verifyReq = { body: { recovery_code_guess: codes[0] } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(verifyReq))).toEqual({ success: true });

        // A wrong guess fails.
        const wrongReq = { body: { recovery_code_guess: "not-a-valid-code" } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(wrongReq))).toEqual({ success: false });

        const used = recoveryCodesRoute.getUsedRecoveryCodes() as { success: boolean; usedRecoveryCodes: string[] };
        expect(used.success).toBe(true);
        // The used code is replaced by an ISO-ish timestamp; the rest stay as indices.
        expect(used.usedRecoveryCodes.some(c => /T/.test(c))).toBe(true);
    });

    it("regenerateRecoveryCodes refuses when no TOTP secret is set", () => {
        const result = cls.init(() => {
            totpService.resetTotp(); // clears any secret + codes
            return recoveryCodesRoute.regenerateRecoveryCodes();
        });
        expect(result.success).toBe(false);
        expect(result.recoveryCodes).toBeUndefined();
        expect(recoveryCodesRoute.checkForRecoveryKeys()).toEqual({ success: true, keysExist: false });
    });

    it("regenerateRecoveryCodes issues and persists fresh codes when a secret is set", () => {
        const result = cls.init(() => {
            totpService.setSecret("JBSWY3DPEHPK3PXP");
            return recoveryCodesRoute.regenerateRecoveryCodes();
        });
        expect(result.success).toBe(true);
        expect(result.recoveryCodes).toHaveLength(8);
        expect(recoveryCodesRoute.checkForRecoveryKeys()).toEqual({ success: true, keysExist: true });
    });

    it("regenerateRecoveryCodes invalidates the previous batch", () => {
        // Seed an initial batch tied to a TOTP secret, capturing one code from it.
        const oldCode = cls.init(() => {
            totpService.setSecret("JBSWY3DPEHPK3PXP");
            const initial = recoveryCodesService.createRecoveryCodes();
            recoveryCodesService.setRecoveryCodes(initial.join(","));
            return initial[0];
        });

        // Regenerating mints a brand-new batch, replacing the old one.
        const regenerated = cls.init(() => recoveryCodesRoute.regenerateRecoveryCodes());
        expect(regenerated.success).toBe(true);
        const newCodes = regenerated.recoveryCodes;
        expect(newCodes).toHaveLength(8);
        const newCode = newCodes?.[0];
        expect(newCode).toBeDefined();

        // A code from the OLD batch must no longer verify after regeneration.
        const oldReq = { body: { recovery_code_guess: oldCode } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(oldReq))).toEqual({ success: false });

        // A code from the NEW batch verifies.
        const newReq = { body: { recovery_code_guess: newCode } } as unknown as Request;
        expect(cls.init(() => recoveryCodesRoute.verifyRecoveryCode(newReq))).toEqual({ success: true });
    });

    it("getUsedRecoveryCodes marks every consumed code as used, including adjacent ones", () => {
        // Seed a batch and consume the first TWO codes, which sit next to each other in the stored
        // order. A used code is stored as a timestamp; an unused one is reported as its numeric index.
        const codes = cls.init(() => {
            totpService.setSecret("JBSWY3DPEHPK3PXP");
            const generated = recoveryCodesService.createRecoveryCodes();
            recoveryCodesService.setRecoveryCodes(generated.join(","));
            return generated;
        });
        cls.init(() => recoveryCodesService.verifyRecoveryCode(codes[0]));
        cls.init(() => recoveryCodesService.verifyRecoveryCode(codes[1]));

        const used = recoveryCodesRoute.getUsedRecoveryCodes() as { success: boolean; usedRecoveryCodes: string[] };
        // Both consumed codes must be reported as used (non-numeric timestamp entries), mirroring the
        // client's isUnusedRecoveryCode check (/^\d+$/). Catches a stateful global regex that would
        // advance past the first match and misclassify the adjacent second code as still available.
        const usedCount = used.usedRecoveryCodes.filter((entry) => !/^\d+$/.test(entry)).length;
        expect(usedCount).toBe(2);
    });
});
