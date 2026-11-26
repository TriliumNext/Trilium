import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getContext } from "../../services/context";
import options from "../../services/options";
import protectedSession from "../../services/protected_session";
import { encodeBase64 } from "../../services/utils/binary";
import ws from "../../services/ws";
import { CoreApiTester } from "../../test/api_tester";

// The protected-session login does real scrypt (N=16384) password verification
// and data-key derivation. Under the browser provider that runs in pure JS
// (@noble/hashes), ~10x slower with V8 coverage instrumentation than Node's native
// scryptSync — enough to blow the 5s default. Give the standalone
// suite a larger timeout; the server suite keeps the strict default.
const isBrowserRuntime = typeof self !== "undefined";
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

    it("answers data-key-unreadable to the correct password, and opens no session", async () => {
        const stored = options.getOption("encryptedDataKey");
        // A value that the recovery path of issue 510 would return as the key.
        getContext().init(() => options.setOption(
            "encryptedDataKey", encodeBase64(Uint8Array.from({ length: 12 }, (_, i) => i))));
        try {
            const res = await api.post<{ success: boolean; code?: string }>(
                "/api/login/protected", { body: { password: "demo1234" } });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: false, code: "data-key-unreadable" });
            expect(protectedSession.isProtectedSessionAvailable()).toBe(false);
        } finally {
            getContext().init(() => options.setOption("encryptedDataKey", stored));
        }
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
