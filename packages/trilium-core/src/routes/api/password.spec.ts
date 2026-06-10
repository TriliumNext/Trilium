import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import passwordService from "../../services/encryption/password";
import { getSql } from "../../services/sql/index";
import { CoreApiTester } from "../../test/api_tester";

// Changing/setting a password does real scrypt (N=16384) hashing + data-key
// re-derivation. Under the browser provider that runs in pure JS (scrypt-js),
// ~10x slower with V8 coverage instrumentation than Node's native scryptSync —
// enough to blow the 5s default. Give the standalone (happy-dom) suite a larger
// timeout; the server suite keeps the strict default.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

/**
 * Drives the shared core password routes through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

function getPasswordHash(): string | null {
    return getSql().getValue<string | null>(
        "SELECT value FROM options WHERE name = 'passwordVerificationHash'"
    );
}

describe("Password API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("changes the password when a password is already set", async () => {
        const res = await api.post<{ success: boolean }>("/api/password/change", {
            body: { current_password: "demo1234", new_password: "newpass5678" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("sets the password via setPassword when none is set yet", async () => {
        const setPassword = vi.spyOn(passwordService, "setPassword").mockResolvedValue({ success: true });
        vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(false);

        const res = await api.post<{ success: boolean }>("/api/password/change", {
            body: { new_password: "brandNew99" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(setPassword).toHaveBeenCalledWith("brandNew99");
    });

    it("rejects a password reset with an incorrect confirmation (400)", async () => {
        const res = await api.post("/api/password/reset", { query: { really: "nope" } });
        expect(res.status).toBe(400);
        // password is still set
        expect(getPasswordHash()).toBeTruthy();
    });

    // Destructive: must run LAST since it clears the password options.
    it("resets the password with the correct confirmation magic string", async () => {
        const res = await api.post<{ success: boolean }>("/api/password/reset", {
            query: { really: "yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(getPasswordHash()).toBe("");
    });
});
