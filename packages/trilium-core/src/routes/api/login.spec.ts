import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import passwordEncryptionService from "../../services/encryption/password_encryption";
import protectedSession from "../../services/protected_session";
import ws from "../../services/ws";
import { CoreApiTester } from "../../test/api_tester";

// The protected-session login does real scrypt (N=16384) password verification
// and data-key derivation. Under the browser provider that runs in pure JS
// (scrypt-js), ~10x slower with V8 coverage instrumentation than Node's native
// scryptSync — enough to blow the 5s default. Give the standalone (happy-dom)
// suite a larger timeout; the server suite keeps the strict default.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

/**
 * Drives the shared core protected-session login routes through
 * {@link CoreApiTester} (no Express), so this spec runs under both the node and
 * standalone (WASM) suites.
 */
let api: CoreApiTester;

describe("Login (protected session) API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        protectedSession.resetDataKey();
    });

    it("rejects a wrong protected-session password", async () => {
        const res = await api.post<{ success: boolean }>("/api/login/protected", {
            body: { password: "wrongpassword" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(protectedSession.isProtectedSessionAvailable()).toBe(false);
    });

    it("returns the 'unable to obtain data key' failure when the data key cannot be decrypted", async () => {
        vi.spyOn(passwordEncryptionService, "getDataKey").mockResolvedValue(null);
        const res = await api.post<{ success: boolean }>("/api/login/protected", {
            body: { password: "demo1234" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(protectedSession.isProtectedSessionAvailable()).toBe(false);
    });

    it("logs in to the protected session with the correct password", async () => {
        const sendMessage = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        const res = await api.post<{ success: boolean }>("/api/login/protected", {
            body: { password: "demo1234" }
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(protectedSession.isProtectedSessionAvailable()).toBe(true);
        expect(sendMessage).toHaveBeenCalledWith({ type: "protectedSessionLogin" });
    });

    it("touches the protected session", async () => {
        // establish a session first
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        await api.post("/api/login/protected", { body: { password: "demo1234" } });

        const res = await api.post("/api/login/protected/touch");
        expect(res.status).toBe(204);
        expect(protectedSession.getLastProtectedSessionOperationDate()).toBeTruthy();
    });

    it("logs out from the protected session", async () => {
        const sendMessage = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        await api.post("/api/login/protected", { body: { password: "demo1234" } });
        expect(protectedSession.isProtectedSessionAvailable()).toBe(true);

        const res = await api.post("/api/logout/protected");
        expect(res.status).toBe(204);
        expect(protectedSession.isProtectedSessionAvailable()).toBe(false);
        expect(sendMessage).toHaveBeenCalledWith({ type: "protectedSessionLogout" });
    });
});
