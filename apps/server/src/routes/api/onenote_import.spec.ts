import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import graph from "../../services/import/onenote/graph.js";
import oauth from "../../services/oauth/oauth.js";
import onenoteImportRoute from "./onenote_import.js";

vi.mock("../../services/oauth/oauth.js", () => ({
    default: {
        requestDeviceCode: vi.fn(),
        pollDeviceToken: vi.fn(),
        refreshAccessToken: vi.fn()
    }
}));

vi.mock("../../services/import/onenote/graph.js", () => ({
    default: {
        getAccount: vi.fn(),
        listNotebooks: vi.fn()
    }
}));

const oauthMock = vi.mocked(oauth);
const graphMock = vi.mocked(graph);

/** A minimal express-session-shaped request: web (non-Electron), with a working save callback. */
function fakeRequest(oneNoteImport?: Request["session"]["oneNoteImport"]): Request {
    const session = {
        oneNoteImport,
        save: (cb: (err?: Error) => void) => cb()
    };
    return { session } as unknown as Request;
}

beforeEach(() => {
    oauthMock.requestDeviceCode.mockReset();
    oauthMock.pollDeviceToken.mockReset();
    graphMock.getAccount.mockReset();
});

describe("deviceLogin", () => {
    it("returns the user-facing codes and keeps the device code secret in the session", async () => {
        oauthMock.requestDeviceCode.mockResolvedValue({
            device_code: "device-secret",
            user_code: "ABCD-1234",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 900,
            interval: 5
        });
        const req = fakeRequest();

        const result = await onenoteImportRoute.deviceLogin(req);

        // The device code is the credential Microsoft polls tokens out with — it must never reach the
        // browser, only the session.
        expect(JSON.stringify(result)).not.toContain("device-secret");
        expect(result).toEqual({
            userCode: "ABCD-1234",
            verificationUri: "https://microsoft.com/devicelogin",
            expiresInSeconds: 900,
            intervalSeconds: 5
        });
        expect(req.session.oneNoteImport?.deviceCode).toBe("device-secret");
    });

    it("discards any previous connection when a new sign-in starts", async () => {
        oauthMock.requestDeviceCode.mockResolvedValue({
            device_code: "device-secret",
            user_code: "ABCD-1234",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 900,
            interval: 5
        });
        const req = fakeRequest({ accessToken: "old-token", account: { name: "Old", email: "old@example.com" } });

        await onenoteImportRoute.deviceLogin(req);

        expect(req.session.oneNoteImport?.accessToken).toBeUndefined();
        expect(req.session.oneNoteImport?.account).toBeUndefined();
    });
});

describe("devicePoll", () => {
    it("rejects a poll with no sign-in in progress", async () => {
        const result = await onenoteImportRoute.devicePoll(fakeRequest());

        expect(result).toEqual([400, expect.stringContaining("No sign-in")]);
        expect(oauthMock.pollDeviceToken).not.toHaveBeenCalled();
    });

    it("reports pending while the user has not finished signing in", async () => {
        oauthMock.pollDeviceToken.mockResolvedValue({ status: "pending" });
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "pending" });
        // The pending state must survive so the next poll can still complete the sign-in.
        expect(req.session.oneNoteImport?.deviceCode).toBe("device-secret");
    });

    it("stores the tokens and account once the sign-in completes", async () => {
        oauthMock.pollDeviceToken.mockResolvedValue({
            status: "success",
            tokens: { token_type: "Bearer", access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }
        });
        graphMock.getAccount.mockResolvedValue({ name: "Ada", email: "ada@example.com" });
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "connected", account: { name: "Ada", email: "ada@example.com" } });
        const stored = req.session.oneNoteImport;
        expect(stored?.accessToken).toBe("access-token");
        expect(stored?.refreshToken).toBe("refresh-token");
        expect(stored?.expiresAt).toBeGreaterThan(Date.now());
        expect(stored?.account).toEqual({ name: "Ada", email: "ada@example.com" });
        // The consumed device code must not linger next to the real tokens.
        expect(stored?.deviceCode).toBeUndefined();
    });

    it("keeps the connection when the profile lookup fails after tokens are issued", async () => {
        // The device code is consumed on success, so the tokens cannot be re-fetched by polling again;
        // a transient getAccount failure must not throw the just-established connection away.
        oauthMock.pollDeviceToken.mockResolvedValue({
            status: "success",
            tokens: { token_type: "Bearer", access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }
        });
        graphMock.getAccount.mockRejectedValue(new Error("Graph timed out"));
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "connected", account: { name: "", email: "" } });
        // Tokens are persisted despite the profile failure, so the import can proceed.
        expect(req.session.oneNoteImport?.accessToken).toBe("access-token");
        expect(req.session.oneNoteImport?.deviceCode).toBeUndefined();
    });

    it("passes slowDown through so the client can widen its polling interval", async () => {
        oauthMock.pollDeviceToken.mockResolvedValue({ status: "pending", slowDown: true });
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        expect(await onenoteImportRoute.devicePoll(req)).toEqual({ status: "pending", slowDown: true });
    });

    it("reports the existing connection instead of re-polling a consumed device code", async () => {
        // Models an overlapping poll: a prior poll already stored the tokens. This one must not poll the
        // now-dead device code (which would fail and wipe the good session).
        const req = fakeRequest({ accessToken: "access-token", account: { name: "Ada", email: "ada@example.com" }, deviceCode: "device-secret" });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "connected", account: { name: "Ada", email: "ada@example.com" } });
        expect(oauthMock.pollDeviceToken).not.toHaveBeenCalled();
        expect(req.session.oneNoteImport?.accessToken).toBe("access-token");
    });

    it("fails and clears the pending sign-in on a terminal error (declined, disabled tenant, ...)", async () => {
        oauthMock.pollDeviceToken.mockRejectedValue(new Error("The sign-in was declined."));
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "failed", error: "The sign-in was declined." });
        expect(req.session.oneNoteImport).toBeUndefined();
    });

    it("fails locally once the code has expired, without polling the provider", async () => {
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() - 1000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "failed", error: expect.stringContaining("expired") });
        expect(req.session.oneNoteImport).toBeUndefined();
        expect(oauthMock.pollDeviceToken).not.toHaveBeenCalled();
    });
});
