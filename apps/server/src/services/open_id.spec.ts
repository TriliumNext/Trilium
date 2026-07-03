import { cls, options } from "@triliumnext/core";
import type { NextFunction, Request as ExpressRequest, RequestHandler, Response as ExpressResponse } from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import config from "./config.js";
import openIDEncryption from "./encryption/open_id_encryption.js";
import openID, { _resetInFlightRefreshesForTesting, createReactiveOidcMiddleware, refreshOidcTokenIfNeeded, resolveOAuthIdentity, supportsRpInitiatedLogout } from "./open_id.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";

const mfa = config.MultiFactorAuthentication;
const originalMfa = { ...mfa };

function setOauthConfig(complete: boolean) {
    mfa.oauthBaseUrl = complete ? "https://app.example.com" : "";
    mfa.oauthClientId = complete ? "client-id" : "";
    mfa.oauthClientSecret = complete ? "client-secret" : "";
    mfa.oauthIssuerBaseUrl = "https://issuer.example.com";
    mfa.oauthIssuerName = "Acme";
    mfa.oauthIssuerIcon = "icon.png";
}

describe("open_id", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    afterEach(() => {
        Object.assign(mfa, originalMfa);
        vi.restoreAllMocks();
    });

    it("checkOpenIDConfig reports each missing oauth variable", () => {
        setOauthConfig(false);
        expect(openID.isOpenIDEnabled()).toBe(false);
        // with all three blank, getOAuthStatus surfaces them
        const status = openID.getOAuthStatus();
        expect(status.success).toBe(true);
        expect(status.missingVars).toEqual(
            expect.arrayContaining(["oauthBaseUrl", "oauthClientId", "oauthClientSecret"])
        );
        expect(status.enabled).toBe(false);
    });

    it("isOpenIDConfigured requires full config and mfaMethod=oauth", () => {
        setOauthConfig(true);
        cls.init(() => options.setOption("mfaMethod", "totp"));
        expect(openID.isOpenIDConfigured()).toBe(false); // method not oauth

        cls.init(() => options.setOption("mfaMethod", "oauth"));
        expect(openID.isOpenIDConfigured()).toBe(true);
        expect(openID.getOAuthStatus().missingVars).toEqual([]);
    });

    it("isOpenIDEnabled additionally requires an enrolled account", () => {
        setOauthConfig(true);
        cls.init(() => options.setOption("mfaMethod", "oauth"));

        // Configured but not enrolled → SSO is not yet the active login method.
        vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(false);
        expect(openID.isOpenIDEnabled()).toBe(false);
        expect(openID.getOAuthStatus().enrolled).toBe(false);

        // Once an identity is bound, OAuth becomes active.
        vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(true);
        expect(openID.isOpenIDEnabled()).toBe(true);
        expect(openID.getOAuthStatus().enrolled).toBe(true);
    });

    it("exposes issuer name/icon from config", () => {
        setOauthConfig(true);
        expect(openID.getSSOIssuerName()).toBe("Acme");
        expect(openID.getSSOIssuerIcon()).toBe("icon.png");
    });

    it("derives the issuer icon from the base URL favicon when none is configured", () => {
        setOauthConfig(true);
        mfa.oauthIssuerIcon = "";

        // Falls back to the issuer's favicon.
        mfa.oauthIssuerBaseUrl = "https://issuer.example.com";
        expect(openID.getSSOIssuerIcon()).toBe("https://issuer.example.com/favicon.ico");

        // Trailing slashes / extra path segments resolve against the origin root.
        mfa.oauthIssuerBaseUrl = "https://accounts.google.com/";
        expect(openID.getSSOIssuerIcon()).toBe("https://accounts.google.com/favicon.ico");

        // No (or invalid) base URL → no icon, leaving the UI to use its glyph fallback.
        mfa.oauthIssuerBaseUrl = "";
        expect(openID.getSSOIssuerIcon()).toBe("");
    });

    it("isUserSaved and getOAuthStatus read user_data", () => {
        cls.init(() => {
            sql.transactional(() => {
                sql.execute("DELETE FROM user_data");
                sql.upsert("user_data", "tmpID", {
                    tmpID: 0,
                    isSetup: "true",
                    username: "Alice",
                    email: "alice@example.com"
                });
            });
        });
        expect(openID.isUserSaved()).toBe(true);
        const status = openID.getOAuthStatus();
        expect(status.name).toBe("Alice");
        expect(status.email).toBe("alice@example.com");
    });

    it("getOAuthStatus surfaces the configured issuer details", () => {
        setOauthConfig(true);
        const status = openID.getOAuthStatus();
        expect(status.issuerName).toBe("Acme");
        expect(status.issuerUrl).toBe("https://issuer.example.com");
        expect(status.issuerIcon).toBe("icon.png");
    });

    it("clearSavedUser empties user_data", () => {
        const result = cls.init(() => openID.clearSavedUser());
        expect(result.success).toBe(true);
        expect(openID.isUserSaved()).toBe(false);
    });

    describe("isTokenValid", () => {
        const fakeRes = {} as never;
        const next = (() => {}) as never;

        it("reports 'not set up' when oidc is undefined", async () => {
            const req = { oidc: undefined } as never;
            const res = await openID.isTokenValid(req, fakeRes, next);
            expect(res.success).toBe(false);
            expect(typeof res.user).toBe("boolean");
        });

        it("reports valid when fetchUserInfo succeeds", async () => {
            const req = { oidc: { fetchUserInfo: vi.fn().mockResolvedValue({}) } } as never;
            const res = await openID.isTokenValid(req, fakeRes, next);
            expect(res.success).toBe(true);
        });

        it("reports invalid when fetchUserInfo throws", async () => {
            const req = {
                oidc: { fetchUserInfo: vi.fn().mockRejectedValue(new Error("nope")) }
            } as never;
            const res = await openID.isTokenValid(req, fakeRes, next);
            expect(res.success).toBe(false);
        });
    });

    describe("generateOAuthConfig.afterCallback", () => {
        function buildConfig() {
            setOauthConfig(true);
            return openID.generateOAuthConfig();
        }

        // express-session exposes a callback-style regenerate(); the success paths call it to defeat
        // session fixation, so the mock session must provide a working one (invoked synchronously here).
        function sessionWith(initial: Record<string, unknown> = {}) {
            return {
                ...initial,
                regenerate(cb: (err?: unknown) => void) {
                    cb();
                }
            } as Record<string, unknown>;
        }

        it("wires routes and credentials from config", () => {
            const cfg = buildConfig();
            expect(cfg.baseURL).toBe("https://app.example.com");
            expect(cfg.clientID).toBe("client-id");
            expect(cfg.routes.callback).toBe("/callback");
            expect(typeof cfg.afterCallback).toBe("function");
        });

        it("auto-selects the token-endpoint auth method by issuer", () => {
            setOauthConfig(true);

            // Non-Google issuer (the setOauthConfig default) → spec-default client_secret_basic.
            expect(openID.generateOAuthConfig().clientAuthMethod).toBe("client_secret_basic");

            // Google issuer (trailing slash tolerated) → client_secret_post, since Google rejects the
            // RFC-encoded Basic credentials (client_ids contain "-"/"." which become %2D/%2E).
            mfa.oauthIssuerBaseUrl = "https://accounts.google.com/";
            expect(openID.generateOAuthConfig().clientAuthMethod).toBe("client_secret_post");
        });

        it("enables RP-Initiated Logout (idpLogout) only when the provider supports it", () => {
            setOauthConfig(true);
            // Default off, and on only when discovery confirmed an end_session_endpoint at startup.
            expect(openID.generateOAuthConfig().idpLogout).toBe(false);
            expect(openID.generateOAuthConfig(false).idpLogout).toBe(false);
            expect(openID.generateOAuthConfig(true).idpLogout).toBe(true);
        });

        it("requests the scope configured via oauthScope", () => {
            setOauthConfig(true);
            mfa.oauthScope = "openid profile email offline_access";
            expect(openID.generateOAuthConfig().authorizationParams.scope).toBe("openid profile email offline_access");
        });

        it("passes the configured oauthHttpTimeout through to the library", () => {
            setOauthConfig(true);
            mfa.oauthHttpTimeout = 45000;
            expect(openID.generateOAuthConfig().httpTimeout).toBe(45000);
        });

        it("bounds the OIDC appSession lifetime to cookieMaxAge (rolling + absolute)", () => {
            setOauthConfig(true);
            const cfg = openID.generateOAuthConfig();
            expect(cfg.session?.rolling).toBe(true);
            expect(cfg.session?.rollingDuration).toBe(config.Session.cookieMaxAge);
            expect(cfg.session?.absoluteDuration).toBe(config.Session.cookieMaxAge);
        });

        it("requests offline access per-issuer, and only when the scope opts into it", () => {
            setOauthConfig(true);

            // Default scope: no offline access params — matches the standard sign-in flow.
            mfa.oauthScope = "openid profile email";
            const plain = openID.generateOAuthConfig().authorizationParams as Record<string, unknown>;
            expect(plain.scope).toBe("openid profile email");
            expect(plain.access_type).toBeUndefined();
            expect(plain.prompt).toBeUndefined();

            // Spec-compliant issuer: the offline_access scope IS the refresh-token request. No
            // Google-specific params — prompt=consent would force the consent screen on every login.
            mfa.oauthScope = "openid profile email offline_access";
            const spec = openID.generateOAuthConfig().authorizationParams as Record<string, unknown>;
            expect(spec.scope).toBe("openid profile email offline_access");
            expect(spec.access_type).toBeUndefined();
            expect(spec.prompt).toBeUndefined();

            // Google: offline_access is not a valid Google scope (invalid_scope), so it is stripped
            // and replaced with Google's own mechanism (access_type=offline + prompt=consent).
            mfa.oauthIssuerBaseUrl = "https://accounts.google.com/";
            const google = openID.generateOAuthConfig().authorizationParams as Record<string, unknown>;
            expect(google.scope).toBe("openid profile email");
            expect(google.access_type).toBe("offline");
            expect(google.prompt).toBe("consent");

            // Google without the opt-in: untouched.
            mfa.oauthScope = "openid profile email";
            const googlePlain = openID.generateOAuthConfig().authorizationParams as Record<string, unknown>;
            expect(googlePlain.scope).toBe("openid profile email");
            expect(googlePlain.access_type).toBeUndefined();
            expect(googlePlain.prompt).toBeUndefined();
        });

        it("returns the session unchanged when the DB is not initialized", async () => {
            const cfg = buildConfig();
            const spy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const session = { marker: 1 } as never;
            const result = await cfg.afterCallback({ oidc: { user: {} } } as never, {} as never, session);
            expect(result).toBe(session);
            spy.mockRestore();
        });

        it("returns the session unchanged when there is no user", async () => {
            const cfg = buildConfig();
            const session = { marker: 2 } as never;
            const result = await cfg.afterCallback({ oidc: { user: undefined } } as never, {} as never, session);
            expect(result).toBe(session);
        });

        it("enrolls the user when an authenticated owner signs in and none is enrolled yet", async () => {
            const cfg = buildConfig();
            // No account enrolled yet, and the request comes from an already-logged-in session (the owner
            // enrolling from Settings) → bind the identity and keep them logged in.
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(false);
            const saveSpy = vi.spyOn(openIDEncryption, "saveUser").mockReturnValue(true);
            const req = {
                oidc: {
                    user: { sub: "sub-1", name: "Alice", email: "alice@example.com" },
                    fetchUserInfo: vi.fn().mockResolvedValue({})
                },
                session: sessionWith({ loggedIn: true })
            } as never;
            const session = { marker: 3 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            expect(saveSpy).toHaveBeenCalledWith("sub-1", "Alice", "alice@example.com");
            expect((req as { session: { loggedIn: boolean } }).session.loggedIn).toBe(true);
            expect(result).toBe(session);
        });

        it("enrolls with name/email from UserInfo when the ID token omits them (Authelia case)", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(false);
            const saveSpy = vi.spyOn(openIDEncryption, "saveUser").mockReturnValue(true);
            // ID token carries only `sub`; the profile claims arrive from the UserInfo endpoint.
            const fetchUserInfo = vi.fn().mockResolvedValue({ name: "Alice", email: "alice@example.com" });
            const req = {
                oidc: { user: { sub: "sub-1" }, fetchUserInfo },
                session: sessionWith({ loggedIn: true })
            } as never;

            await cfg.afterCallback(req, {} as never, { marker: 7 } as never);

            expect(fetchUserInfo).toHaveBeenCalled();
            expect(saveSpy).toHaveBeenCalledWith("sub-1", "Alice", "alice@example.com");
        });

        it("falls back to ID token claims when the UserInfo fetch fails", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(false);
            const saveSpy = vi.spyOn(openIDEncryption, "saveUser").mockReturnValue(true);
            const req = {
                oidc: {
                    user: { sub: "sub-1", name: "Alice", email: "alice@example.com" },
                    fetchUserInfo: vi.fn().mockRejectedValue(new Error("network down"))
                },
                session: sessionWith({ loggedIn: true })
            } as never;

            await cfg.afterCallback(req, {} as never, { marker: 8 } as never);

            expect(saveSpy).toHaveBeenCalledWith("sub-1", "Alice", "alice@example.com");
        });

        it("refuses enrollment from an unauthenticated session (no first-login claim)", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(false);
            const saveSpy = vi.spyOn(openIDEncryption, "saveUser").mockReturnValue(true);
            const req = {
                oidc: { user: { sub: "stranger", name: "Mallory", email: "mallory@evil.example" } },
                session: {} as Record<string, unknown>
            } as never;
            const session = { marker: 4 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            expect(saveSpy).not.toHaveBeenCalled();
            expect((req as { session: { loggedIn?: boolean } }).session.loggedIn).toBeFalsy();
            expect((req as { session: { ssoError?: string } }).session.ssoError).toBe("not_enrolled");
            expect(result).toBe(session);
        });

        it("logs in an enrolled user only when the subject identifier matches", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(true);
            const verifySpy = vi.spyOn(openIDEncryption, "verifySubjectIdentifier").mockReturnValue(true);
            const req = {
                oidc: { user: { sub: "enrolled-sub", name: "Alice", email: "alice@example.com" } },
                session: sessionWith()
            } as never;
            const session = { marker: 5 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            expect(verifySpy).toHaveBeenCalledWith("enrolled-sub");
            expect((req as { session: { loggedIn: boolean } }).session.loggedIn).toBe(true);
            expect((req as { session: { lastAuthState: { ssoEnabled: boolean } } }).session.lastAuthState.ssoEnabled).toBe(true);
            expect(result).toBe(session);
        });

        it("rejects login when the authenticated account is not the enrolled one", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(true);
            vi.spyOn(openIDEncryption, "verifySubjectIdentifier").mockReturnValue(false);
            const req = {
                oidc: { user: { sub: "other-sub", name: "Mallory", email: "mallory@evil.example" } },
                session: {} as Record<string, unknown>
            } as never;
            const session = { marker: 6 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            expect((req as { session: { loggedIn: boolean } }).session.loggedIn).toBe(false);
            expect((req as { session: { ssoError?: string } }).session.ssoError).toBe("wrong_account");
            expect(result).toBe(session);
        });

        it("fails closed when session regeneration errors", async () => {
            const cfg = buildConfig();
            vi.spyOn(openIDEncryption, "isSubjectIdentifierSaved").mockReturnValue(true);
            vi.spyOn(openIDEncryption, "verifySubjectIdentifier").mockReturnValue(true);
            const req = {
                oidc: { user: { sub: "enrolled-sub", name: "Alice", email: "alice@example.com" } },
                session: {
                    regenerate(cb: (err?: unknown) => void) {
                        cb(new Error("store unavailable"));
                    }
                } as Record<string, unknown>
            } as never;
            const session = { marker: 9 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            // Regeneration failed → the session must not be elevated.
            expect((req as { session: { loggedIn: boolean } }).session.loggedIn).toBe(false);
            expect((req as { session: { lastAuthState?: unknown } }).session.lastAuthState).toBeUndefined();
            expect(result).toBe(session);
        });
    });

    describe("resolveOAuthIdentity", () => {
        it("prefers the ID token claims when present", () => {
            const identity = resolveOAuthIdentity(
                { name: "Alice", email: "alice@id.example" },
                { name: "Other", email: "other@userinfo.example" }
            );
            expect(identity).toEqual({ name: "Alice", email: "alice@id.example" });
        });

        it("falls back to UserInfo per-field when the ID token omits or blanks a claim", () => {
            expect(resolveOAuthIdentity({ sub: "x" }, { name: "Alice", email: "alice@example.com" }))
                .toEqual({ name: "Alice", email: "alice@example.com" });
            // Empty strings in the ID token are treated as missing.
            expect(resolveOAuthIdentity({ name: "", email: "alice@id.example" }, { name: "Alice" }))
                .toEqual({ name: "Alice", email: "alice@id.example" });
        });

        it("yields empty strings when a claim is on neither source", () => {
            expect(resolveOAuthIdentity({ sub: "x" }, undefined)).toEqual({ name: "", email: "" });
            expect(resolveOAuthIdentity(undefined, undefined)).toEqual({ name: "", email: "" });
            // Non-string claim values are ignored rather than coerced.
            expect(resolveOAuthIdentity({ name: 42, email: null }, undefined)).toEqual({ name: "", email: "" });
        });
    });

    describe("supportsRpInitiatedLogout", () => {
        it("is true only for a non-empty string end_session_endpoint", () => {
            expect(supportsRpInitiatedLogout({ end_session_endpoint: "https://idp.example/logout" })).toBe(true);
            expect(supportsRpInitiatedLogout({ end_session_endpoint: "" })).toBe(false);
            // Provider without the endpoint (Google, Authelia) — the case that crashes idpLogout.
            expect(supportsRpInitiatedLogout({ authorization_endpoint: "https://idp.example/auth" })).toBe(false);
            // Non-string / non-object inputs are rejected rather than coerced.
            expect(supportsRpInitiatedLogout({ end_session_endpoint: 42 })).toBe(false);
            expect(supportsRpInitiatedLogout(null)).toBe(false);
            expect(supportsRpInitiatedLogout(undefined)).toBe(false);
            expect(supportsRpInitiatedLogout("not an object")).toBe(false);
        });
    });

    describe("isRpInitiatedLogoutSupported", () => {
        const wellKnownUrl = "https://issuer.example.com/.well-known/openid-configuration";

        function mockFetch(impl: (url: string) => Partial<Response> | Promise<Partial<Response>>) {
            return vi.spyOn(globalThis, "fetch").mockImplementation(
                ((url: string) => Promise.resolve(impl(url))) as typeof fetch
            );
        }

        it("fetches the issuer's discovery document and reflects end_session_endpoint", async () => {
            setOauthConfig(true);
            const fetchSpy = mockFetch(() => ({
                ok: true,
                json: () => Promise.resolve({ end_session_endpoint: "https://issuer.example.com/logout" })
            }));

            expect(await openID.isRpInitiatedLogoutSupported()).toBe(true);
            expect(fetchSpy).toHaveBeenCalledWith(wellKnownUrl, expect.anything());
        });

        it("is false when discovery omits end_session_endpoint", async () => {
            setOauthConfig(true);
            mockFetch(() => ({ ok: true, json: () => Promise.resolve({}) }));
            expect(await openID.isRpInitiatedLogoutSupported()).toBe(false);
        });

        it("fails closed (false) on a non-OK response or a thrown fetch", async () => {
            setOauthConfig(true);

            mockFetch(() => ({ ok: false, status: 404, json: () => Promise.resolve({}) }));
            expect(await openID.isRpInitiatedLogoutSupported()).toBe(false);

            vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
            expect(await openID.isRpInitiatedLogoutSupported()).toBe(false);
        });

        it("does not attempt discovery when no issuer is configured", async () => {
            setOauthConfig(true);
            mfa.oauthIssuerBaseUrl = "";
            const fetchSpy = mockFetch(() => ({ ok: true, json: () => Promise.resolve({}) }));

            expect(await openID.isRpInitiatedLogoutSupported()).toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });
});

/**
 * The reactive OIDC middleware is the fix for "switching the MFA method to OpenID requires a server
 * restart". The old code decided *once at startup* whether to mount express-openid-connect; these tests
 * pin down the new contract: the middleware is always mounted, re-evaluates `isOpenIDConfigured()` on
 * every request, and lazily builds (and caches) the underlying handler the first time OAuth is used.
 */
describe("createReactiveOidcMiddleware", () => {
    function setup() {
        let configured = false;

        const oidcHandler = vi.fn(((_req, _res, next) => next()) as RequestHandler);
        const buildAuth = vi.fn(() => oidcHandler);
        const isRpInitiatedLogoutSupported = vi.fn().mockResolvedValue(false);
        const generateOAuthConfig = vi.fn((endSessionSupported: boolean) => ({ endSessionSupported }) as never);
        const isConfigured = vi.fn(() => configured);

        const middleware = createReactiveOidcMiddleware({
            isConfigured,
            isRpInitiatedLogoutSupported,
            generateOAuthConfig,
            buildAuth
        });

        return {
            middleware,
            oidcHandler,
            buildAuth,
            isRpInitiatedLogoutSupported,
            generateOAuthConfig,
            isConfigured,
            setConfigured: (value: boolean) => { configured = value; }
        };
    }

    async function run(middleware: RequestHandler) {
        const next = vi.fn() as unknown as NextFunction;
        const req = {} as ExpressRequest;
        const res = {} as ExpressResponse;
        await middleware(req, res, next);
        return { next, req, res };
    }

    it("passes through without building the OIDC handler when OAuth is not selected", async () => {
        const t = setup(); // starts unconfigured

        const { next } = await run(t.middleware);

        expect(next).toHaveBeenCalledOnce();
        expect(t.buildAuth).not.toHaveBeenCalled();
        expect(t.oidcHandler).not.toHaveBeenCalled();
        // No work is done while OAuth is unselected — not even the discovery probe.
        expect(t.isRpInitiatedLogoutSupported).not.toHaveBeenCalled();
    });

    it("builds and delegates to the OIDC handler when OAuth is selected", async () => {
        const t = setup();
        t.setConfigured(true);

        const { req, res, next } = await run(t.middleware);

        expect(t.isRpInitiatedLogoutSupported).toHaveBeenCalledOnce();
        expect(t.generateOAuthConfig).toHaveBeenCalledWith(false);
        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledWith(req, res, expect.any(Function));
        // The wrapper must hand off to the OIDC handler and NOT call next() itself — calling it again
        // after the handler already drove the request double-invokes the pipeline ("Cannot set headers
        // after they are sent"). Exactly one next() (the one the handler makes) must reach the chain.
        expect(next).toHaveBeenCalledOnce();
    });

    it("builds the underlying handler only once across requests (cached)", async () => {
        const t = setup();
        t.setConfigured(true);

        await run(t.middleware);
        await run(t.middleware);

        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.isRpInitiatedLogoutSupported).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledTimes(2);
    });

    it("passes the discovery-probe result into the OAuth config", async () => {
        const t = setup();
        t.isRpInitiatedLogoutSupported.mockResolvedValue(true);
        t.setConfigured(true);

        await run(t.middleware);

        expect(t.generateOAuthConfig).toHaveBeenCalledWith(true);
    });

    // This is the regression the whole change exists to fix: with the old startup-only mount, flipping
    // mfaMethod to "oauth" at runtime did nothing until a restart. Here the same instance starts
    // unselected (passes through) and then activates on the next request after the option flips.
    it("activates without a restart when the sign-in method switches to OAuth at runtime", async () => {
        const t = setup(); // unconfigured at "boot"

        await run(t.middleware);
        expect(t.buildAuth).not.toHaveBeenCalled();
        expect(t.oidcHandler).not.toHaveBeenCalled();

        // User switches the MFA method to OpenID in Settings — no restart.
        t.setConfigured(true);

        const { req, res } = await run(t.middleware);
        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledWith(req, res, expect.any(Function));
    });

    it("stops delegating when OAuth is deselected at runtime", async () => {
        const t = setup();
        t.setConfigured(true);
        await run(t.middleware); // builds + delegates
        expect(t.oidcHandler).toHaveBeenCalledOnce();

        // Switch back to local/TOTP — the request should pass straight through again.
        t.setConfigured(false);
        const { next } = await run(t.middleware);

        expect(next).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledOnce(); // not invoked a second time
    });

    it("builds the handler only once even under concurrent first requests", async () => {
        const t = setup();
        t.setConfigured(true);

        // A deferred discovery probe keeps the first build in flight while a second request arrives,
        // exercising the in-flight-init guard (otherwise both requests would each build a handler).
        let resolveProbe: (value: boolean) => void = () => {};
        t.isRpInitiatedLogoutSupported.mockReturnValue(new Promise<boolean>((resolve) => { resolveProbe = resolve; }));

        const first = run(t.middleware);
        const second = run(t.middleware);
        resolveProbe(false);
        await Promise.all([first, second]);

        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledTimes(2);
    });

    // A failed first init must not be cached as a permanently-rejected promise: a transient failure
    // (discovery probe error, malformed config) would otherwise break every subsequent OAuth request
    // until a server restart. The next request must be allowed to retry and recover.
    it("retries the build on a subsequent request after a failed init", async () => {
        const t = setup();
        t.setConfigured(true);
        t.isRpInitiatedLogoutSupported.mockRejectedValueOnce(new Error("transient discovery failure"));

        await expect(run(t.middleware)).rejects.toThrow("transient discovery failure");
        expect(t.oidcHandler).not.toHaveBeenCalled();

        // Second request: the probe succeeds and the handler is finally built and delegated to.
        const { req, res } = await run(t.middleware);
        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledWith(req, res, expect.any(Function));
    });
});

describe("refreshOidcTokenIfNeeded", () => {
    const res = {} as ExpressResponse;
    let sessionCounter = 0;

    beforeEach(() => {
        _resetInFlightRefreshesForTesting();
    });

    // Waits for the microtask chain (refreshPromise.then/catch → next) to settle.
    function flushMicrotasks() {
        return new Promise((resolve) => setImmediate(resolve));
    }

    function makeReq(oidc: Record<string, unknown> | undefined, session: Record<string, unknown> | undefined, sessionID?: string) {
        sessionCounter += 1;
        const req = { oidc, session, sessionID: sessionID ?? `sid-${sessionCounter}` } as unknown as ExpressRequest;
        return { req, session };
    }

    function expiredOidc(refresh: ReturnType<typeof vi.fn>) {
        // refresh() lives on the AccessToken, matching the library API the middleware calls.
        return {
            isAuthenticated: vi.fn(() => true),
            accessToken: { isExpired: vi.fn(() => true), refresh },
            refreshToken: "rt"
        };
    }

    it("passes through without refreshing when the user is not OIDC-authenticated", () => {
        const refresh = vi.fn();
        const next = vi.fn();
        const { req } = makeReq({ isAuthenticated: vi.fn(() => false), refresh }, { loggedIn: true });

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("passes through when the local session is not logged in", () => {
        const refresh = vi.fn();
        const next = vi.fn();
        const { req } = makeReq({ isAuthenticated: vi.fn(() => true), refresh }, { loggedIn: false });

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("passes through when the access token is still valid", () => {
        const refresh = vi.fn();
        const next = vi.fn();
        const { req } = makeReq(
            { isAuthenticated: vi.fn(() => true), accessToken: { isExpired: vi.fn(() => false) }, refreshToken: "rt", refresh },
            { loggedIn: true }
        );

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("passes through when no refresh token is present (offline_access not granted)", () => {
        const refresh = vi.fn();
        const next = vi.fn();
        // Built inline: passing undefined to expiredOidc's defaulted param would resurrect the default.
        const { req } = makeReq(
            { isAuthenticated: vi.fn(() => true), accessToken: { isExpired: vi.fn(() => true), refresh }, refreshToken: undefined },
            { loggedIn: true }
        );

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes the token and calls next on success", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        const next = vi.fn();
        const { req } = makeReq(expiredOidc(refresh), { loggedIn: true });

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
    });

    it("soft-fails on a transient refresh error so the local session survives an IdP outage", async () => {
        const refresh = vi.fn().mockRejectedValue(new Error("network down"));
        const next = vi.fn();
        const { req, session } = makeReq(expiredOidc(refresh), { loggedIn: true });

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        expect(session?.loggedIn).toBe(true);
    });

    it("forces re-authentication on invalid_grant by marking the session not-logged-in", async () => {
        const invalidGrant = Object.assign(new Error("Token revoked"), { error: "invalid_grant" });
        const refresh = vi.fn().mockRejectedValue(invalidGrant);
        const next = vi.fn();
        const { req, session } = makeReq(expiredOidc(refresh), { loggedIn: true });

        refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        // checkAuth (downstream) sees !loggedIn and redirects to /login.
        expect(session?.loggedIn).toBe(false);
    });

    it("propagates rotated tokens into piggybacking requests' appSession", async () => {
        // Each request decodes its own copy of the appSession cookie; the library's refresh() only
        // updates the initiator's copy. The middleware must copy the rotated tokens into piggybackers
        // so their (rolling) response cookies don't clobber the fresh pair with the consumed one.
        const staleTokens = { access_token: "at-old", refresh_token: "rt-old", id_token: "idt-old", token_type: "Bearer", expires_at: 1 };
        const appSession1 = { ...staleTokens };
        const appSession2 = { ...staleTokens };

        let resolveRefresh: () => void = () => undefined;
        const refresh1 = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
        const req1 = {
            ...makeReq(expiredOidc(refresh1), { loggedIn: true }, "shared-sid").req,
            appSession: appSession1
        } as unknown as ExpressRequest;
        const req2 = {
            ...makeReq(expiredOidc(vi.fn()), { loggedIn: true }, "shared-sid").req,
            appSession: appSession2
        } as unknown as ExpressRequest;
        const next1 = vi.fn();
        const next2 = vi.fn();

        refreshOidcTokenIfNeeded(req1, res, next1 as NextFunction);
        refreshOidcTokenIfNeeded(req2, res, next2 as NextFunction);

        // Simulate the library: refresh() writes the rotated tokens into the initiator's appSession.
        Object.assign(appSession1, { access_token: "at-new", refresh_token: "rt-new", expires_at: 999 });
        resolveRefresh();
        await flushMicrotasks();

        expect(next1).toHaveBeenCalledOnce();
        expect(next2).toHaveBeenCalledOnce();
        // The piggybacker's session now carries the rotated pair, not the consumed one.
        expect(appSession2.access_token).toBe("at-new");
        expect(appSession2.refresh_token).toBe("rt-new");
        expect(appSession2.expires_at).toBe(999);
    });

    it("coalesces concurrent refreshes for the same session into a single IdP call", async () => {
        let resolveRefresh: () => void = () => undefined;
        const refresh1 = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
        const refresh2 = vi.fn();
        const next1 = vi.fn();
        const next2 = vi.fn();
        const { req: req1 } = makeReq(expiredOidc(refresh1), { loggedIn: true }, "shared-sid");
        const { req: req2 } = makeReq(expiredOidc(refresh2), { loggedIn: true }, "shared-sid");

        refreshOidcTokenIfNeeded(req1, res, next1 as NextFunction);
        refreshOidcTokenIfNeeded(req2, res, next2 as NextFunction);

        // Only the first request hits the IdP; the second piggy-backs on the in-flight promise.
        expect(refresh1).toHaveBeenCalledOnce();
        expect(refresh2).not.toHaveBeenCalled();

        resolveRefresh();
        await flushMicrotasks();

        expect(next1).toHaveBeenCalledOnce();
        expect(next2).toHaveBeenCalledOnce();
    });
});
