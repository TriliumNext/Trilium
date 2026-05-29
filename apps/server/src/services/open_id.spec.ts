import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import type { Session } from "express-openid-connect";

// --- Mocks for dependencies of open_id.ts -----------------------------------
// Note: open_id.ts reads `config.MultiFactorAuthentication.*` and
// `config.Session.cookieMaxAge` at the time `generateOAuthConfig()` is called,
// so we expose a mutable mock object and reset it in beforeEach.

const mockConfig = {
    Session: {
        cookieMaxAge: 21 * 24 * 60 * 60
    },
    MultiFactorAuthentication: {
        oauthBaseUrl: "https://app.example.com",
        oauthClientId: "client-id",
        oauthClientSecret: "client-secret",
        oauthIssuerBaseUrl: "https://issuer.example.com",
        oauthIssuerName: "Example",
        oauthIssuerIcon: "",
        oauthHttpTimeout: 30000,
        oauthScope: "openid profile email"
    }
};

vi.mock("./config.js", () => ({
    default: mockConfig
}));

vi.mock("./encryption/open_id_encryption.js", () => ({
    default: {
        saveUser: vi.fn(),
        isSubjectIdentifierSaved: vi.fn(() => false)
    }
}));

vi.mock("./options.js", () => ({
    default: {
        getOptionOrNull: vi.fn(() => "oauth"),
        setOption: vi.fn()
    }
}));

vi.mock("./sql.js", () => ({
    default: {
        getValue: vi.fn(),
        execute: vi.fn()
    }
}));

vi.mock("./sql_init.js", () => ({
    default: {
        isDbInitialized: vi.fn(() => true)
    }
}));

vi.mock("./log.js", () => ({
    default: {
        info: vi.fn(),
        error: vi.fn()
    }
}));

// --- Helpers ----------------------------------------------------------------

interface FakeSession {
    loggedIn?: boolean;
    lastAuthState?: { totpEnabled: boolean; ssoEnabled: boolean };
    regenerate: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
}

function makeRequest(opts: {
    user?: any;
    regenerateError?: Error | null;
    saveError?: Error | null;
} = {}): Request & { session: FakeSession } {
    const session: FakeSession = {
        regenerate: vi.fn((cb: (err: Error | null) => void) => {
            // Simulate node:express-session regenerate semantics: callback is async-like.
            queueMicrotask(() => cb(opts.regenerateError ?? null));
        }),
        save: vi.fn((cb: (err: Error | null) => void) => {
            queueMicrotask(() => cb(opts.saveError ?? null));
        })
    };

    return {
        oidc: {
            user: opts.user,
            fetchUserInfo: vi.fn()
        },
        session
    } as unknown as Request & { session: FakeSession };
}

// --- Tests ------------------------------------------------------------------

describe("open_id service", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset mutable mock config to defaults before each test.
        mockConfig.Session.cookieMaxAge = 21 * 24 * 60 * 60;
        mockConfig.MultiFactorAuthentication.oauthBaseUrl = "https://app.example.com";
        mockConfig.MultiFactorAuthentication.oauthClientId = "client-id";
        mockConfig.MultiFactorAuthentication.oauthClientSecret = "client-secret";
        mockConfig.MultiFactorAuthentication.oauthIssuerBaseUrl = "https://issuer.example.com";
        mockConfig.MultiFactorAuthentication.oauthIssuerName = "Example";
        mockConfig.MultiFactorAuthentication.oauthIssuerIcon = "";
        mockConfig.MultiFactorAuthentication.oauthHttpTimeout = 30000;
        mockConfig.MultiFactorAuthentication.oauthScope = "openid profile email";

        const sqlInit = (await import("./sql_init.js")).default;
        (sqlInit.isDbInitialized as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("generateOAuthConfig", () => {
        it("uses the configured scope, httpTimeout, and bounded session lifetime", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const cfg = openIdService.generateOAuthConfig();

            expect(cfg.authorizationParams.scope).toBe("openid profile email");
            expect(cfg.httpTimeout).toBe(30000);
            // Both rolling and absolute durations are matched to the trilium.sid cookieMaxAge so
            // the OIDC appSession does not silently cap the user's session at the library default
            // of 7 days.
            expect(cfg.session).toEqual({
                rolling: true,
                rollingDuration: 21 * 24 * 60 * 60,
                absoluteDuration: 21 * 24 * 60 * 60
            });
        });

        it("forwards updated config values into the returned auth config", async () => {
            mockConfig.Session.cookieMaxAge = 60 * 60;
            mockConfig.MultiFactorAuthentication.oauthHttpTimeout = 12000;
            mockConfig.MultiFactorAuthentication.oauthScope = "openid profile email offline_access";

            const { default: openIdService } = await import("./open_id.js");
            const cfg = openIdService.generateOAuthConfig();

            expect(cfg.authorizationParams.scope).toBe("openid profile email offline_access");
            expect(cfg.httpTimeout).toBe(12000);
            expect(cfg.session.rollingDuration).toBe(60 * 60);
            expect(cfg.session.absoluteDuration).toBe(60 * 60);
        });

        it("preserves the existing OAuth route map and required fields", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const cfg = openIdService.generateOAuthConfig();

            expect(cfg.routes).toEqual({
                callback: "/callback",
                login: "/authenticate",
                postLogoutRedirect: "/login",
                logout: "/logout"
            });
            expect(cfg.authRequired).toBe(false);
            expect(cfg.idpLogout).toBe(true);
            expect(cfg.baseURL).toBe("https://app.example.com");
            expect(cfg.clientID).toBe("client-id");
            expect(cfg.clientSecret).toBe("client-secret");
            expect(cfg.secret).toBe("client-secret");
            expect(cfg.issuerBaseURL).toBe("https://issuer.example.com");
        });
    });

    describe("afterCallback", () => {
        it("regenerates the trilium.sid session, sets loggedIn, and saves before resolving", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const encryption = (await import("./encryption/open_id_encryption.js")).default;

            const cfg = openIdService.generateOAuthConfig();
            const req = makeRequest({
                user: { sub: "subject-1", name: "Alice", email: "alice@example.com" }
            });
            const res = {} as Response;
            const inputSession: Session = { foo: "bar" } as any;

            const returnedSession = await cfg.afterCallback(req as any, res, inputSession);

            // saveUser is invoked with the OIDC claims.
            expect(encryption.saveUser).toHaveBeenCalledWith(
                "subject-1",
                "Alice",
                "alice@example.com"
            );

            // Session was regenerated (defense-in-depth against fixation) and explicitly saved.
            expect(req.session.regenerate).toHaveBeenCalledTimes(1);
            expect(req.session.save).toHaveBeenCalledTimes(1);

            // loggedIn flag flipped on the regenerated session, with SSO state recorded.
            expect(req.session.loggedIn).toBe(true);
            expect(req.session.lastAuthState).toEqual({
                totpEnabled: false,
                ssoEnabled: true
            });

            // afterCallback returns the original library session unchanged.
            expect(returnedSession).toBe(inputSession);
        });

        it("rejects when session regeneration fails so the caller surfaces the error", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const log = (await import("./log.js")).default;

            const cfg = openIdService.generateOAuthConfig();
            const regenError = new Error("regen failed");
            const req = makeRequest({
                user: { sub: "s", name: "n", email: "e@e" },
                regenerateError: regenError
            });
            const res = {} as Response;

            await expect(
                cfg.afterCallback(req as any, res, {} as any)
            ).rejects.toBe(regenError);

            expect(req.session.save).not.toHaveBeenCalled();
            expect(log.error).toHaveBeenCalledWith(
                expect.stringContaining("Failed to regenerate session")
            );
        });

        it("rejects when session save fails after a successful regenerate", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const log = (await import("./log.js")).default;

            const cfg = openIdService.generateOAuthConfig();
            const saveError = new Error("save failed");
            const req = makeRequest({
                user: { sub: "s", name: "n", email: "e@e" },
                saveError
            });

            await expect(
                cfg.afterCallback(req as any, {} as Response, {} as any)
            ).rejects.toBe(saveError);

            expect(req.session.regenerate).toHaveBeenCalledTimes(1);
            expect(log.error).toHaveBeenCalledWith(
                expect.stringContaining("Failed to save session")
            );
        });

        it("returns early without touching the trilium.sid session when the DB is not initialized", async () => {
            const sqlInit = (await import("./sql_init.js")).default;
            (sqlInit.isDbInitialized as ReturnType<typeof vi.fn>).mockReturnValue(false);

            const { default: openIdService } = await import("./open_id.js");
            const encryption = (await import("./encryption/open_id_encryption.js")).default;

            const cfg = openIdService.generateOAuthConfig();
            const req = makeRequest({
                user: { sub: "s", name: "n", email: "e@e" }
            });
            const inputSession = {} as Session;

            const result = await cfg.afterCallback(req as any, {} as Response, inputSession);

            expect(result).toBe(inputSession);
            expect(encryption.saveUser).not.toHaveBeenCalled();
            expect(req.session.regenerate).not.toHaveBeenCalled();
            expect(req.session.save).not.toHaveBeenCalled();
        });

        it("logs an error and aborts when the OIDC provider returned no user info", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const encryption = (await import("./encryption/open_id_encryption.js")).default;
            const log = (await import("./log.js")).default;

            const cfg = openIdService.generateOAuthConfig();
            const req = makeRequest({ user: undefined });
            const inputSession = { existing: true } as unknown as Session;

            const result = await cfg.afterCallback(req as any, {} as Response, inputSession);

            expect(result).toBe(inputSession);
            expect(encryption.saveUser).not.toHaveBeenCalled();
            expect(req.session.regenerate).not.toHaveBeenCalled();
            expect(log.error).toHaveBeenCalledWith(
                expect.stringContaining("OIDC callback received without user info")
            );
        });
    });

    describe("isTokenValid", () => {
        it("logs the underlying error when fetchUserInfo throws and reports invalid", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const log = (await import("./log.js")).default;

            const req = {
                oidc: {
                    fetchUserInfo: vi.fn().mockRejectedValue(new Error("token expired"))
                }
            } as unknown as Request;

            const result = await openIdService.isTokenValid(req, {} as Response, vi.fn() as any);

            expect(result).toEqual({
                success: false,
                message: "Token is not valid",
                user: false
            });
            expect(log.info).toHaveBeenCalledWith(
                expect.stringContaining("OIDC token validation failed")
            );
            expect(log.info).toHaveBeenCalledWith(
                expect.stringContaining("token expired")
            );
        });

        it("returns success when fetchUserInfo resolves", async () => {
            const { default: openIdService } = await import("./open_id.js");

            const req = {
                oidc: {
                    fetchUserInfo: vi.fn().mockResolvedValue({ sub: "s" })
                }
            } as unknown as Request;

            const result = await openIdService.isTokenValid(req, {} as Response, vi.fn() as any);

            expect(result.success).toBe(true);
            expect(result.message).toBe("Token is valid");
        });

        it("reports 'Token not set up' when the OIDC middleware never attached", async () => {
            const { default: openIdService } = await import("./open_id.js");

            const req = {} as Request;
            const result = await openIdService.isTokenValid(req, {} as Response, vi.fn() as any);

            expect(result).toEqual({
                success: false,
                message: "Token not set up",
                user: false
            });
        });

        it("normalizes non-Error rejections into their string form in the log line", async () => {
            const { default: openIdService } = await import("./open_id.js");
            const log = (await import("./log.js")).default;

            const req = {
                oidc: {
                    fetchUserInfo: vi.fn().mockRejectedValue("plain string failure")
                }
            } as unknown as Request;

            await openIdService.isTokenValid(req, {} as Response, vi.fn() as any);

            expect(log.info).toHaveBeenCalledWith(
                expect.stringContaining("plain string failure")
            );
        });
    });
});
