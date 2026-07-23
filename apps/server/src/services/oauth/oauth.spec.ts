import { afterEach, describe, expect, it, vi } from "vitest";

import { type OAuthProviderConfig, pollDeviceToken, requestDeviceCode } from "./oauth.js";

const CONFIG: OAuthProviderConfig = {
    authorizeEndpoint: "https://login.example.com/authorize",
    tokenEndpoint: "https://login.example.com/token",
    deviceCodeEndpoint: "https://login.example.com/devicecode",
    clientId: "client-123",
    scopes: "offline_access User.Read Notes.Read"
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

/** The urlencoded body the mocked fetch received on its `call`-th invocation. */
function sentBody(call = 0): URLSearchParams {
    return new URLSearchParams(String(fetchMock.mock.calls[call]?.[1]?.body));
}

afterEach(() => {
    fetchMock.mockReset();
});

describe("requestDeviceCode", () => {
    it("posts the client id and scopes to the device code endpoint and returns the codes", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, {
            device_code: "device-secret",
            user_code: "ABCD-1234",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 900,
            interval: 5,
            message: "Go sign in."
        }));

        const result = await requestDeviceCode(CONFIG);

        expect(fetchMock).toHaveBeenCalledWith(CONFIG.deviceCodeEndpoint, expect.objectContaining({ method: "POST" }));
        const body = sentBody();
        expect(body.get("client_id")).toBe("client-123");
        expect(body.get("scope")).toBe("offline_access User.Read Notes.Read");

        expect(result).toEqual({
            device_code: "device-secret",
            user_code: "ABCD-1234",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 900,
            interval: 5,
            message: "Go sign in."
        });
    });

    it("surfaces the provider's error description on failure", async () => {
        fetchMock.mockResolvedValue(jsonResponse(400, { error: "invalid_client", error_description: "Client not enabled for device flow." }));

        await expect(requestDeviceCode(CONFIG)).rejects.toThrow("Client not enabled for device flow.");
    });

    it("falls back to the HTTP status when the response is not JSON (e.g. a proxy error page)", async () => {
        fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

        await expect(requestDeviceCode(CONFIG)).rejects.toThrow("HTTP 502");
    });
});

describe("pollDeviceToken", () => {
    it("exchanges the device code for tokens once the user has signed in", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, {
            token_type: "Bearer",
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3599
        }));

        const result = await pollDeviceToken(CONFIG, "device-secret");

        expect(fetchMock).toHaveBeenCalledWith(CONFIG.tokenEndpoint, expect.objectContaining({ method: "POST" }));
        const body = sentBody();
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
        expect(body.get("device_code")).toBe("device-secret");
        expect(body.get("client_id")).toBe("client-123");

        expect(result).toEqual({
            status: "success",
            tokens: expect.objectContaining({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3599 })
        });
    });

    it("reports pending while the user has not finished signing in", async () => {
        // `authorization_pending` is the normal keep-polling response; `slow_down` also means "not yet"
        // (just poll less eagerly), so both map to pending rather than an error.
        fetchMock.mockResolvedValue(jsonResponse(400, { error: "authorization_pending" }));
        await expect(pollDeviceToken(CONFIG, "device-secret")).resolves.toEqual({ status: "pending" });
    });

    it("reports pending with slowDown so the caller widens its polling interval", async () => {
        fetchMock.mockResolvedValue(jsonResponse(400, { error: "slow_down" }));
        await expect(pollDeviceToken(CONFIG, "device-secret")).resolves.toEqual({ status: "pending", slowDown: true });
    });

    it("throws a friendly error when the user declined (authorization_declined or access_denied)", async () => {
        for (const error of ["authorization_declined", "access_denied"]) {
            fetchMock.mockResolvedValue(jsonResponse(400, { error }));
            await expect(pollDeviceToken(CONFIG, "device-secret")).rejects.toThrow(/declined/);
        }
    });

    it("throws a friendly error when the code expired before the user signed in", async () => {
        fetchMock.mockResolvedValue(jsonResponse(400, { error: "expired_token" }));

        await expect(pollDeviceToken(CONFIG, "device-secret")).rejects.toThrow(/expired/);
    });

    it("keeps polling (does not abandon the sign-in) on a transient network failure", async () => {
        fetchMock.mockRejectedValue(new Error("ECONNRESET"));

        await expect(pollDeviceToken(CONFIG, "device-secret")).resolves.toEqual({ status: "pending" });
    });

    it("keeps polling on an unrecognised or 5xx error rather than treating it as terminal", async () => {
        // A server-side hiccup at the token endpoint must not kill an otherwise valid sign-in; only the
        // known terminal outcomes (declined, expired) end it.
        fetchMock.mockResolvedValue(jsonResponse(500, { error: "temporarily_unavailable" }));
        await expect(pollDeviceToken(CONFIG, "device-secret")).resolves.toEqual({ status: "pending" });

        fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
        await expect(pollDeviceToken(CONFIG, "device-secret")).resolves.toEqual({ status: "pending" });
    });
});
