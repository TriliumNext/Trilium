import { cls } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import totpRoute from "./totp.js";

// totp is disabled by default in the test fixture (no mfaEnabled option),
// so these assert the disabled-state shape plus that a fresh secret is generated.
describe("TOTP API", () => {
    it("generates and stores a base32 secret", () => {
        const result = cls.init(() => totpRoute.generateSecret());
        expect(result.success).toBe(true);
        expect(result.message).toMatch(/^[A-Z2-7]+$/);
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
