import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    authorize: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    getAccount: vi.fn<(getToken: () => Promise<string>) => Promise<unknown>>(),
    setDesktopSession: vi.fn(),
    logError: vi.fn()
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn) }
    }
}));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ error: h.logError }),
    utils: { safeExtractMessageAndStackFromError: (e: unknown) => String(e) }
}));
vi.mock("@triliumnext/server/src/services/import/onenote/desktop_session.js", () => ({ setDesktopSession: h.setDesktopSession }));
vi.mock("@triliumnext/server/src/services/import/onenote/graph.js", () => ({ default: { getAccount: h.getAccount } }));
vi.mock("@triliumnext/server/src/services/import/onenote/oauth.js", () => ({ ONENOTE_OAUTH: { clientId: "onenote" } }));
vi.mock("./loopback_oauth.js", () => ({ authorizeViaLoopback: h.authorize }));

const { setupOneNoteHandlers } = await import("./onenote.js");

function login() {
    return h.handlers.get("onenote-login")?.() as Promise<unknown>;
}

describe("onenote-login", () => {
    beforeEach(() => {
        h.handlers.clear();
        vi.clearAllMocks();
        setupOneNoteHandlers();
    });

    it("signs in, resolves the account with the new token and stores the session", async () => {
        vi.spyOn(Date, "now").mockReturnValue(1_000);
        const account = { displayName: "Me", email: "me@example.com" };
        h.authorize.mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_in: 60 });
        h.getAccount.mockImplementation(async (getToken) => {
            expect(await getToken()).toBe("at");
            return account;
        });

        expect(await login()).toEqual({ connected: true, account });
        expect(h.authorize).toHaveBeenCalledWith({ clientId: "onenote" });
        expect(h.setDesktopSession).toHaveBeenCalledWith({ accessToken: "at", refreshToken: "rt", expiresAt: 61_000, account });
        vi.restoreAllMocks();
    });

    it("reports a failed sign-in, including a non-Error rejection", async () => {
        h.authorize.mockRejectedValueOnce(new Error("Timed out"));
        expect(await login()).toEqual({ connected: false, error: "Timed out" });

        h.authorize.mockRejectedValueOnce("cancelled");
        expect(await login()).toEqual({ connected: false, error: "cancelled" });

        expect(h.logError).toHaveBeenCalledTimes(2);
        expect(h.setDesktopSession).not.toHaveBeenCalled();
    });
});
