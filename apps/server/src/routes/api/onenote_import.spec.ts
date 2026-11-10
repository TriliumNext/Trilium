import type { Request } from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../../services/electron_request.js";
import { getDesktopSession, setDesktopSession } from "../../services/import/onenote/desktop_session.js";
import graph from "../../services/import/onenote/graph.js";
import importer from "../../services/import/onenote/importer.js";
import oauth from "../../services/oauth/oauth.js";
import sqlInit from "../../services/sql_init.js";
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

vi.mock("../../services/import/onenote/importer.js", () => ({
    default: {
        importSelection: vi.fn(() => Promise.resolve())
    }
}));

const oauthMock = vi.mocked(oauth);
const graphMock = vi.mocked(graph);
const importerMock = vi.mocked(importer);

/** A minimal express-session-shaped request: web (non-Electron), with a working save callback. */
function fakeRequest(oneNoteImport?: Request["session"]["oneNoteImport"]): Request {
    const session = {
        oneNoteImport,
        save: (cb: (err?: Error) => void) => cb()
    };
    return { session } as unknown as Request;
}

/** A request dispatched over the desktop `trilium-app://` protocol, carrying `body` and no usable session. */
function fakeElectronRequest(body?: unknown): Request {
    const req = { body, session: {} } as unknown as Request;
    markAsInternalElectronRequest(req);
    return req;
}

beforeEach(() => {
    oauthMock.requestDeviceCode.mockReset();
    oauthMock.pollDeviceToken.mockReset();
    oauthMock.refreshAccessToken.mockReset();
    graphMock.getAccount.mockReset();
    graphMock.listNotebooks.mockReset();
    importerMock.importSelection.mockClear();
    setDesktopSession(null);
});

describe("getStatus and disconnect", () => {
    it("reads and clears the web connection from the express session", async () => {
        const account = { name: "Ada", email: "ada@example.com" };
        const req = fakeRequest({ accessToken: "access-token", account });

        expect(onenoteImportRoute.getStatus(req)).toEqual({ connected: true, account });

        expect(await onenoteImportRoute.disconnect(req)).toEqual({});
        expect(req.session.oneNoteImport).toBeUndefined();
        expect(onenoteImportRoute.getStatus(req)).toEqual({ connected: false, account: null });
    });

    it("reports a stored token without an account as connected with no account", () => {
        expect(onenoteImportRoute.getStatus(fakeRequest({ accessToken: "access-token" }))).toEqual({ connected: true, account: null });
    });

    it("keeps the desktop connection in the process-wide session, not the request's", async () => {
        const req = fakeElectronRequest();
        expect(onenoteImportRoute.getStatus(req)).toEqual({ connected: false, account: null });

        const account = { name: "Desk", email: "desk@example.com" };
        setDesktopSession({ accessToken: "desktop-token", account });
        expect(onenoteImportRoute.getStatus(req)).toEqual({ connected: true, account });
        expect(req.session.oneNoteImport).toBeUndefined();

        await onenoteImportRoute.disconnect(req);
        expect(getDesktopSession()).toBeNull();
    });
});

describe("token refresh through the route's token store", () => {
    it("refreshes an expired web token and merges the new tokens into the session, keeping the account", async () => {
        oauthMock.refreshAccessToken.mockResolvedValue({ token_type: "Bearer", access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 3600 });
        graphMock.listNotebooks.mockResolvedValue([]);
        const account = { name: "Ada", email: "ada@example.com" };
        const req = fakeRequest({ accessToken: "stale-token", refreshToken: "old-refresh", expiresAt: Date.now() - 1000, account });

        expect(await onenoteImportRoute.getNotebooks(req)).toEqual({ notebooks: [] });
        expect(oauthMock.refreshAccessToken).toHaveBeenCalledWith(expect.anything(), { refreshToken: "old-refresh" });
        expect(req.session.oneNoteImport).toMatchObject({ accessToken: "fresh-token", refreshToken: "fresh-refresh", account });
        // The notebook listing ran with the refreshed token, not the stale one.
        const provider = graphMock.listNotebooks.mock.calls[0]?.[0];
        expect(await provider?.()).toBe("fresh-token");
    });

    it("refreshes an expired desktop token into the process-wide session, keeping the account", async () => {
        oauthMock.refreshAccessToken.mockResolvedValue({ token_type: "Bearer", access_token: "fresh-desktop", refresh_token: "fresh-refresh", expires_in: 3600 });
        graphMock.listNotebooks.mockResolvedValue([]);
        const account = { name: "Desk", email: "desk@example.com" };
        setDesktopSession({ accessToken: "stale", refreshToken: "old-refresh", expiresAt: Date.now() - 1000, account });

        await onenoteImportRoute.getNotebooks(fakeElectronRequest());

        expect(getDesktopSession()).toMatchObject({ accessToken: "fresh-desktop", refreshToken: "fresh-refresh", account });
    });

    it("rejects the request when the session cannot be saved", async () => {
        oauthMock.refreshAccessToken.mockResolvedValue({ token_type: "Bearer", access_token: "fresh-token", expires_in: 3600 });
        const req = fakeRequest({ accessToken: "stale-token", refreshToken: "old-refresh", expiresAt: Date.now() - 1000 });
        req.session.save = ((cb: (err?: Error) => void) => cb(new Error("session store unavailable"))) as Request["session"]["save"];

        // The failed save surfaces as the connection failure reason instead of a silent success.
        expect(await onenoteImportRoute.getNotebooks(req)).toEqual([401, "session store unavailable"]);
        expect(graphMock.listNotebooks).not.toHaveBeenCalled();
    });

    it("reports a non-Error failure verbatim, and a generic reason when the failure carries none", async () => {
        const failingSave = (err: unknown) => {
            oauthMock.refreshAccessToken.mockResolvedValueOnce({ token_type: "Bearer", access_token: "fresh-token", expires_in: 3600 });
            const req = fakeRequest({ accessToken: "stale-token", refreshToken: "old-refresh", expiresAt: Date.now() - 1000 });
            req.session.save = ((cb: (e?: unknown) => void) => cb(err)) as unknown as Request["session"]["save"];
            return req;
        };

        expect(await onenoteImportRoute.getNotebooks(failingSave("disk full"))).toEqual([401, "disk full"]);
        expect(await onenoteImportRoute.getNotebooks(failingSave(new Error("")))).toEqual([401, "Not connected to OneNote."]);
    });
});

describe("runImport", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    const sections = [{ id: "sec-1", title: "Section", groupPath: [], notebookId: "nb-1", notebookTitle: "Notebook" }];
    const connected = (body: unknown) => {
        setDesktopSession({ accessToken: "desktop-token", expiresAt: Date.now() + 3_600_000 });
        return fakeElectronRequest(body);
    };

    it("starts the import in the background with the request's token provider and options", async () => {
        const req = connected({ parentNoteId: "root", sections, taskId: "task-1", debug: 1, shrinkImages: "" });

        expect(await onenoteImportRoute.runImport(req)).toEqual({});
        expect(importerMock.importSelection).toHaveBeenCalledWith({
            getAccessToken: expect.any(Function),
            parentNoteId: "root",
            sections,
            taskId: "task-1",
            debug: true,
            shrinkImages: false
        });
        const provider = importerMock.importSelection.mock.calls[0]?.[0].getAccessToken;
        expect(await provider?.()).toBe("desktop-token");
    });

    it("refuses to start without a usable connection", async () => {
        expect(await onenoteImportRoute.runImport(fakeElectronRequest({ parentNoteId: "root", sections, taskId: "task-1" })))
            .toEqual([401, expect.stringContaining("sign in again")]);
        expect(importerMock.importSelection).not.toHaveBeenCalled();
    });

    it("validates the request before starting anything", async () => {
        await expect(onenoteImportRoute.runImport(connected({ sections, taskId: "task-1" }))).rejects.toThrow("parentNoteId and taskId are required.");
        await expect(onenoteImportRoute.runImport(connected({ parentNoteId: "root", sections }))).rejects.toThrow("parentNoteId and taskId are required.");
        expect(await onenoteImportRoute.runImport(connected({ parentNoteId: "root", sections: [], taskId: "task-1" }))).toEqual([400, "No sections were selected."]);
        expect(await onenoteImportRoute.runImport(connected({ parentNoteId: "root", sections: "sec-1", taskId: "task-1" }))).toEqual([400, "No sections were selected."]);
        await expect(onenoteImportRoute.runImport(connected({ parentNoteId: "doesNotExist", sections, taskId: "task-1" }))).rejects.toThrow(/doesNotExist/);
        expect(importerMock.importSelection).not.toHaveBeenCalled();
    });
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

describe("getNotebooks", () => {
    it("lists the notebooks while the stored token is still valid", async () => {
        graphMock.listNotebooks.mockResolvedValue([{ id: "nb1", title: "Notebook 1", sections: [], sectionGroups: [] }]);
        const req = fakeRequest({ accessToken: "access-token", refreshToken: "refresh-token", expiresAt: Date.now() + 3_600_000 });

        expect(await onenoteImportRoute.getNotebooks(req)).toEqual({ notebooks: [{ id: "nb1", title: "Notebook 1", sections: [], sectionGroups: [] }] });
        expect(oauthMock.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("reports why an expired connection failed instead of an empty notebook list", async () => {
        // The status endpoint still calls this session connected (a token is stored), so a flat 401 would
        // leave the dialog showing "no notebooks were found" for what is really an expired sign-in.
        oauthMock.refreshAccessToken.mockRejectedValue(new Error("OAuth token request failed: AADSTS700082: The refresh token has expired."));
        const req = fakeRequest({ accessToken: "stale-token", refreshToken: "dead-refresh-token", expiresAt: Date.now() - 1000 });

        expect(await onenoteImportRoute.getNotebooks(req)).toEqual([401, expect.stringContaining("The refresh token has expired.")]);
        expect(graphMock.listNotebooks).not.toHaveBeenCalled();
    });

    it("tells a disconnected session to sign in again rather than listing nothing", async () => {
        expect(await onenoteImportRoute.getNotebooks(fakeRequest())).toEqual([401, expect.stringContaining("sign in again")]);
        expect(graphMock.listNotebooks).not.toHaveBeenCalled();
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
        // The profile lookup authenticates with the freshly issued token.
        expect(await graphMock.getAccount.mock.calls[0]?.[0]()).toBe("access-token");
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

        // A non-Error rejection is reported as its string form.
        oauthMock.pollDeviceToken.mockRejectedValue("access_denied");
        const second = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });
        expect(await onenoteImportRoute.devicePoll(second)).toEqual({ status: "failed", error: "access_denied" });
    });

    it("reports an earlier connection without a profile as connected with a blank account", async () => {
        const result = await onenoteImportRoute.devicePoll(fakeRequest({ accessToken: "access-token" }));

        expect(result).toEqual({ status: "connected", account: { name: "", email: "" } });
        expect(oauthMock.pollDeviceToken).not.toHaveBeenCalled();
    });

    it("keeps the connection when the profile lookup rejects with a non-Error value", async () => {
        oauthMock.pollDeviceToken.mockResolvedValue({
            status: "success",
            tokens: { token_type: "Bearer", access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }
        });
        graphMock.getAccount.mockRejectedValue("timeout");
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() + 900_000 });

        expect(await onenoteImportRoute.devicePoll(req)).toEqual({ status: "connected", account: { name: "", email: "" } });
        expect(req.session.oneNoteImport?.accessToken).toBe("access-token");
    });

    it("fails locally once the code has expired, without polling the provider", async () => {
        const req = fakeRequest({ deviceCode: "device-secret", deviceCodeExpiresAt: Date.now() - 1000 });

        const result = await onenoteImportRoute.devicePoll(req);

        expect(result).toEqual({ status: "failed", error: expect.stringContaining("expired") });
        expect(req.session.oneNoteImport).toBeUndefined();
        expect(oauthMock.pollDeviceToken).not.toHaveBeenCalled();
    });
});
