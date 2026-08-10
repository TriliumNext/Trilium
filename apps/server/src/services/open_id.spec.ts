import { cls, getLog, options } from "@triliumnext/core";
import type { NextFunction, Request as ExpressRequest, RequestHandler, Response as ExpressResponse } from "express";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { authorizationCodeGrant, ClientSecretBasic, ClientSecretPost, type CustomFetch, customFetch, discovery } from "openid-client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { describeError } from "../routes/error_handlers.js";
import config from "./config.js";
import openIDEncryption from "./encryption/open_id_encryption.js";
import openID, { createReactiveOidcMiddleware, DEFAULT_ID_TOKEN_SIGNING_ALG, discoveryUrlFor, reconcileIssuerBaseUrl, resolveClientAuthMethod, resolveIdTokenSigningAlg, resolveOAuthIdentity, supportsRpInitiatedLogout } from "./open_id.js";
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
    mfa.oauthClientAuthMethod = "";
    mfa.oauthIdTokenSigningAlg = "";
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

        it("passes the resolved token-endpoint auth method through to express-openid-connect", () => {
            setOauthConfig(true);
            expect(openID.generateOAuthConfig().clientAuthMethod).toBe("client_secret_basic");

            mfa.oauthIssuerBaseUrl = "https://gitlab.com";
            expect(openID.generateOAuthConfig().clientAuthMethod).toBe("client_secret_post");
        });

        it("enables RP-Initiated Logout (idpLogout) only when the provider supports it", () => {
            setOauthConfig(true);
            // Default off, and on only when discovery confirmed an end_session_endpoint at startup.
            expect(openID.generateOAuthConfig().idpLogout).toBe(false);
            expect(openID.generateOAuthConfig(false).idpLogout).toBe(false);
            expect(openID.generateOAuthConfig(true).idpLogout).toBe(true);
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

    /**
     * Regression cover for #10585: OIDC login against GitLab broke in v0.104.0 with
     * `OAUTH_WWW_AUTHENTICATE_CHALLENGE`, caused by the express-openid-connect 2.20.2 → 3.2.0 bump
     * (openid-client v5 → v6/oauth4webapi). v6's `ClientSecretBasic` applies strict RFC 6749 §2.3.1
     * form-encoding *inside* the HTTP Basic header, escaping `- _ . ! ~ * ' ( )`; v5 used plain
     * `encodeURIComponent`, which leaves them alone.
     */
    describe("resolveClientAuthMethod", () => {
        it("uses client_secret_post only for issuers that can't decode Basic credentials", () => {
            setOauthConfig(true);

            // GitLab's secrets are `gloas-` prefixed; Google's client_ids always carry "-" and ".".
            mfa.oauthIssuerBaseUrl = "https://gitlab.com";
            expect(resolveClientAuthMethod()).toBe("client_secret_post");
            mfa.oauthIssuerBaseUrl = "https://accounts.google.com/"; // trailing slash tolerated
            expect(resolveClientAuthMethod()).toBe("client_secret_post");

            // Everyone else keeps the OIDC Core default. Critically this includes providers that
            // *advertise* client_secret_post but register the client as basic and reject a mismatch
            // (Authelia responds 401 invalid_client), which is why this is an issuer table and not a
            // reading of token_endpoint_auth_methods_supported.
            mfa.oauthIssuerBaseUrl = "https://auth.example.com:9091";
            expect(resolveClientAuthMethod()).toBe("client_secret_basic");

            // A self-hosted instance is not the public issuer, so it does not match the table.
            mfa.oauthIssuerBaseUrl = "https://gitlab.example.com";
            expect(resolveClientAuthMethod()).toBe("client_secret_basic");
        });

        it("lets an explicit oauthClientAuthMethod override the issuer table", () => {
            setOauthConfig(true);

            // The escape hatch for self-hosted GitLab and any provider we don't know about.
            mfa.oauthIssuerBaseUrl = "https://gitlab.example.com";
            mfa.oauthClientAuthMethod = "client_secret_post";
            expect(resolveClientAuthMethod()).toBe("client_secret_post");

            // It overrides in both directions, so a table entry can be undone if a provider changes.
            mfa.oauthIssuerBaseUrl = "https://gitlab.com";
            mfa.oauthClientAuthMethod = "  client_secret_basic  ";
            expect(resolveClientAuthMethod()).toBe("client_secret_basic");

            // An unrecognised value is logged and ignored rather than passed to express-openid-connect,
            // whose Joi schema would otherwise reject it and take the whole server down at first use.
            const logSpy = vi.spyOn(getLog(), "error").mockImplementation(() => {});
            mfa.oauthClientAuthMethod = "private_key_jwt";
            expect(resolveClientAuthMethod()).toBe("client_secret_post");
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("private_key_jwt"));
        });

        /**
         * The property the issuer table exists to protect. `client_secret_post` puts the credentials in
         * the form body, which every provider form-decodes, so they always arrive intact. Under
         * `client_secret_basic` they arrive intact *only* if the provider percent-decodes per spec —
         * both halves are pinned so the tradeoff stays explicit.
         */
        it("delivers credentials to the token endpoint intact under the selected method", () => {
            setOauthConfig(true);

            // GitLab: 64-hex Application ID, `gloas-` prefixed secret (the hyphen is what breaks Basic).
            const clientId = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
            const clientSecret = "gloas-4f3a2b1c-9d8e-7f6a-5b4c-3d2e1f0a9b8c";
            mfa.oauthIssuerBaseUrl = "https://gitlab.com";

            expect(credentialsAtTokenEndpoint(resolveClientAuthMethod(), clientId, clientSecret))
                .toEqual({ clientId, clientSecret });

            // Had GitLab been left on basic, Doorkeeper would have compared against a mangled secret —
            // this is the exact corruption behind #10585.
            expect(credentialsAtTokenEndpoint("client_secret_basic", clientId, clientSecret))
                .toEqual({ clientId, clientSecret: "gloas%2D4f3a2b1c%2D9d8e%2D7f6a%2D5b4c%2D3d2e1f0a9b8c" });
        });

        it("relies on the provider decoding per spec when it stays on basic", () => {
            setOauthConfig(true);
            // The credentials from Trilium's own Authelia dev harness; the "_" is what Basic escapes.
            const clientId = "trilium";
            const clientSecret = "insecure_secret";
            mfa.oauthIssuerBaseUrl = "https://auth.example.com:9091";
            const method = resolveClientAuthMethod();
            expect(method).toBe("client_secret_basic");

            // Authelia percent-decodes per RFC 6749, so the credentials round-trip correctly.
            expect(credentialsAtTokenEndpoint(method, clientId, clientSecret, { percentDecodes: true }))
                .toEqual({ clientId, clientSecret });
        });
    });

    describe("probeDiscovery", () => {
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
                json: () => Promise.resolve({
                    issuer: "https://issuer.example.com",
                    end_session_endpoint: "https://issuer.example.com/logout"
                })
            }));

            expect(await openID.probeDiscovery()).toEqual({
                endSessionSupported: true,
                issuerBaseUrl: "https://issuer.example.com",
                idTokenSigningAlg: "RS256",
                metadataAvailable: true
            });
            expect(fetchSpy).toHaveBeenCalledWith(wellKnownUrl, expect.anything());
        });

        it("is false when discovery omits end_session_endpoint", async () => {
            setOauthConfig(true);
            mockFetch(() => ({ ok: true, json: () => Promise.resolve({}) }));
            expect((await openID.probeDiscovery()).endSessionSupported).toBe(false);
        });

        it("adopts the advertised issuer when it differs only by a trailing slash", async () => {
            // The Authentik shape from #10695: the document is served for the slashless URL, but the
            // issuer it advertises carries the slash, and that is what express-openid-connect must be
            // handed for openid-client's equality check to pass.
            setOauthConfig(true);
            mfa.oauthIssuerBaseUrl = "https://sso.example.com/application/o/trilium-app";
            mockFetch(() => ({
                ok: true,
                json: () => Promise.resolve({ issuer: "https://sso.example.com/application/o/trilium-app/" })
            }));

            expect((await openID.probeDiscovery()).issuerBaseUrl)
                .toBe("https://sso.example.com/application/o/trilium-app/");
        });

        it("fails closed on a non-OK response or a thrown fetch, keeping the configured issuer", async () => {
            setOauthConfig(true);

            mockFetch(() => ({ ok: false, status: 404, json: () => Promise.resolve({}) }));
            expect(await openID.probeDiscovery()).toEqual({
                endSessionSupported: false,
                issuerBaseUrl: "https://issuer.example.com",
                idTokenSigningAlg: "RS256",
                metadataAvailable: false
            });

            vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
            expect(await openID.probeDiscovery()).toEqual({
                endSessionSupported: false,
                issuerBaseUrl: "https://issuer.example.com",
                idTokenSigningAlg: "RS256",
                metadataAvailable: false
            });
        });

        it("does not attempt discovery when no issuer is configured", async () => {
            setOauthConfig(true);
            mfa.oauthIssuerBaseUrl = "";
            const fetchSpy = mockFetch(() => ({ ok: true, json: () => Promise.resolve({}) }));

            expect(await openID.probeDiscovery()).toEqual({
                endSessionSupported: false,
                issuerBaseUrl: "",
                idTokenSigningAlg: "RS256",
                metadataAvailable: false
            });
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        /**
         * An issuer configured as an explicit `.well-known` URL — the documented way out of Authentik's
         * "global" issuer mode (see reconcileIssuerBaseUrl), and what a user reported having to undo.
         *
         * openid-client uses such a URL as-is, so sign-in worked while the probe was advisory: appending
         * a second `.well-known` 404'd, and the only casualty was RP-Initiated Logout. Once the signing
         * algorithm came from the probe that blind spot stopped being harmless — a non-RS256 provider
         * would fall back to RS256 and reject every token — and it also costs the handler its cache,
         * since a probe that reads nothing is deliberately never cached.
         */
        it("uses an issuer that already points at a discovery document as-is", async () => {
            setOauthConfig(true);
            mfa.oauthIssuerBaseUrl = "https://sso.example.com/application/o/trilium/.well-known/openid-configuration";
            const fetchSpy = mockFetch(() => ({
                ok: true,
                json: () => Promise.resolve({
                    issuer: "https://sso.example.com/",
                    id_token_signing_alg_values_supported: ["ES256"]
                })
            }));

            const probe = await openID.probeDiscovery();

            // Fetched exactly as configured — not with a second `.well-known` bolted on.
            expect(fetchSpy).toHaveBeenCalledWith(mfa.oauthIssuerBaseUrl, expect.anything());
            expect(probe.idTokenSigningAlg).toBe("ES256");
            // Read, so the handler built from it is cacheable rather than rebuilt on every request.
            expect(probe.metadataAvailable).toBe(true);
            // The `.well-known` URL itself must reach express-openid-connect: the advertised issuer
            // differs by more than a trailing slash (that is the whole point of this mode), and
            // openid-client skips its equality check for such URLs.
            expect(probe.issuerBaseUrl).toBe(mfa.oauthIssuerBaseUrl);
        });

        it("reports the signing algorithm the issuer advertises", async () => {
            // Pocket ID with an Ed25519 key (discussion 6318): RS256 is not on offer at all, so expecting it is
            // what produced "unexpected JWT alg received, expected RS256, got: EdDSA".
            setOauthConfig(true);
            mockFetch(() => ({
                ok: true,
                json: () => Promise.resolve({
                    issuer: "https://issuer.example.com",
                    id_token_signing_alg_values_supported: ["EdDSA"]
                })
            }));

            expect((await openID.probeDiscovery()).idTokenSigningAlg).toBe("EdDSA");
        });
    });

    /**
     * Cover for https://github.com/orgs/TriliumNext/discussions/6318: express-openid-connect defaults
     * `idTokenSigningAlg` to RS256 and hands it to openid-client as the client's registered
     * `id_token_signed_response_alg`, which is then enforced on every ID token. Trilium never set it, so
     * any provider signing with something else — Pocket ID and Kanidm sign Ed25519 by default — failed
     * the round-trip outright.
     */
    describe("resolveIdTokenSigningAlg", () => {
        it("keeps RS256 unless the issuer rules it out", () => {
            setOauthConfig(true);

            // No document, an unusable one, or one that says nothing about signing: the OIDC Core
            // default stands, so nothing changes for a deployment that works today.
            expect(resolveIdTokenSigningAlg(null)).toBe("RS256");
            expect(resolveIdTokenSigningAlg("not an object")).toBe("RS256");
            expect(resolveIdTokenSigningAlg({})).toBe("RS256");
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: "RS256" })).toBe("RS256");

            // Advertised alongside others, in any position — RS256 is preferred whenever it is on offer,
            // so a provider that supports both keeps signing exactly as it does today.
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["RS256", "EdDSA"] })).toBe("RS256");
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["EdDSA", "ES256", "RS256"] })).toBe("RS256");
        });

        it("adopts the issuer's algorithm when RS256 is not offered", () => {
            setOauthConfig(true);
            const logSpy = vi.spyOn(getLog(), "info").mockImplementation(() => {});

            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["EdDSA"] })).toBe("EdDSA");
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("EdDSA"));
            // First advertised wins among several; providers list their own preference first.
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["ES256", "EdDSA"] })).toBe("ES256");

            // "none" would leave ID tokens unsigned, and express-openid-connect's schema rejects it —
            // passing it through would take the whole OIDC round-trip down at build time.
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["none"] })).toBe("RS256");
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["none", "EdDSA"] })).toBe("EdDSA");
            // Junk entries are ignored rather than handed on as an algorithm.
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: [null, "", 256, "EdDSA"] })).toBe("EdDSA");
        });

        it("lets an explicit oauthIdTokenSigningAlg override discovery", () => {
            setOauthConfig(true);

            // The escape hatch for a provider that misadvertises, in both directions.
            mfa.oauthIdTokenSigningAlg = "  EdDSA  ";
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["RS256"] })).toBe("EdDSA");
            mfa.oauthIdTokenSigningAlg = "RS512";
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["EdDSA"] })).toBe("RS512");

            // ...but not into accepting unsigned ID tokens: that is logged and ignored, leaving
            // discovery to answer, rather than reaching express-openid-connect's schema (which rejects
            // "none" and would take the OIDC round-trip down at build time).
            const logSpy = vi.spyOn(getLog(), "error").mockImplementation(() => {});
            mfa.oauthIdTokenSigningAlg = "none";
            expect(resolveIdTokenSigningAlg({ id_token_signing_alg_values_supported: ["EdDSA"] })).toBe("EdDSA");
            expect(resolveIdTokenSigningAlg(null)).toBe("RS256");
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("none"));
        });

        /**
         * The other half of the loop. The cases above pin what Trilium *resolves*; these pin that the
         * resolved value is what openid-client then accepts, by running a real authorization-code
         * exchange against a provider that genuinely signs Ed25519 — the Pocket ID shape from the report.
         */
        describe("against a real Ed25519-signing provider", () => {
            it("rejects the ID token while the client expects RS256", async () => {
                // The reported failure, reproduced end to end: the token is validly signed and the
                // signature verifies, but the client is registered as expecting an algorithm the issuer
                // does not use, so the exchange is refused before any claim is read.
                expect(await eddsaIdTokenOutcome(DEFAULT_ID_TOKEN_SIGNING_ALG))
                    .toContain('unexpected JWT "alg" header parameter');
            });

            it("accepts it once the expected algorithm is the issuer's", async () => {
                expect(await eddsaIdTokenOutcome("EdDSA")).toBe("accepted");
            });

            it("resolves, from that provider's own discovery document, an algorithm that is accepted", async () => {
                setOauthConfig(true);
                const pocketId = { id_token_signing_alg_values_supported: ["EdDSA"] };
                expect(await eddsaIdTokenOutcome(resolveIdTokenSigningAlg(pocketId))).toBe("accepted");
            });
        });

        it("closes the loop: the resolved algorithm is what reaches express-openid-connect", () => {
            setOauthConfig(true);

            // Unset, the library would silently apply its RS256 default — the bug.
            expect(openID.generateOAuthConfig().idTokenSigningAlg).toBe("RS256");
            expect(openID.generateOAuthConfig(false, mfa.oauthIssuerBaseUrl, "EdDSA").idTokenSigningAlg).toBe("EdDSA");

            // A configured value applies even to callers that never probed discovery.
            mfa.oauthIdTokenSigningAlg = "ES256";
            expect(openID.generateOAuthConfig().idTokenSigningAlg).toBe("ES256");
        });
    });

    describe("discoveryUrlFor", () => {
        it("appends the well-known path, or leaves an already-complete discovery URL alone", () => {
            // The ordinary case, including a path-bearing issuer (Keycloak realms, Authentik apps).
            expect(discoveryUrlFor("https://issuer.example.com"))
                .toBe("https://issuer.example.com/.well-known/openid-configuration");
            expect(discoveryUrlFor("https://sso.example.com/realms/trilium"))
                .toBe("https://sso.example.com/realms/trilium/.well-known/openid-configuration");

            // Already a discovery endpoint — appending again would 404. Matches openid-client's own
            // test (`!href.includes('/.well-known/')`), so both agree on what is already an endpoint.
            const wellKnown = "https://sso.example.com/application/o/trilium/.well-known/openid-configuration";
            expect(discoveryUrlFor(wellKnown)).toBe(wellKnown);
            // Any `/.well-known/` path counts, not just openid-configuration — again mirroring the library.
            expect(discoveryUrlFor("https://sso.example.com/.well-known/oauth-authorization-server"))
                .toBe("https://sso.example.com/.well-known/oauth-authorization-server");
            // A bare `/.well-known` (no trailing segment) is not one, and the library agrees.
            expect(discoveryUrlFor("https://sso.example.com/.well-known"))
                .toBe("https://sso.example.com/.well-known/.well-known/openid-configuration");
        });
    });

    /**
     * Cover for #10695: OIDC login against Authentik broke in v0.104.0 with
     * `OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED`, caused by the same express-openid-connect 2.20.2 → 3.2.0
     * bump behind #10585. v6's `discovery()` asserts that the discovery document's `issuer` equals the
     * issuer URL it was handed; v5's `Issuer.discover()` performed no such comparison, so any mismatch
     * was silently tolerated before the upgrade.
     *
     * The comparison is `new URL(advertised).href !== new URL(configured).href`, and that normalisation
     * is what makes the failure provider-shaped rather than universal — see {@link discoveryOutcome}.
     */
    describe("issuer identifier matching", () => {
        it("tolerates a trailing slash either way on an origin-only issuer", async () => {
            // Authelia's issuer carries no path, so `href` normalisation supplies the trailing slash on
            // both sides and the two spellings collapse onto each other. This is why Trilium's Authelia
            // dev harness (apps/server/docker/authelia) cannot reproduce #10695 at all.
            const authelia = "https://auth.example.com:9091";
            expect(await discoveryOutcome(authelia, authelia)).toBe("accepted");
            expect(await discoveryOutcome(`${authelia}/`, authelia)).toBe("accepted");
        });

        it("rejects a path-bearing issuer spelled with the wrong trailing slash", async () => {
            // `href` neither adds nor strips a trailing slash on a *non-empty* path, so once the issuer
            // carries one the user has to match the provider's spelling exactly. Both orientations occur
            // in the wild, which is why normalising in a single direction cannot be the fix.

            // Authentik advertises the trailing slash; #10695's reporter configured it without one.
            const authentik = "https://sso.example.com/application/o/trilium-app/";
            expect(await discoveryOutcome(authentik, authentik)).toBe("accepted");
            expect(await discoveryOutcome(authentik.replace(/\/$/, ""), authentik))
                .toBe("OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED");

            // Keycloak is the mirror image: it advertises no trailing slash, so adding one breaks it.
            const keycloak = "https://sso.example.com/realms/trilium";
            expect(await discoveryOutcome(keycloak, keycloak)).toBe("accepted");
            expect(await discoveryOutcome(`${keycloak}/`, keycloak))
                .toBe("OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED");
        });

        it("still rejects an issuer that differs by more than a trailing slash", async () => {
            // The bound on any tolerance Trilium adds: the comparison is a genuine security check, so a
            // document claiming a different host or realm must keep failing.
            const keycloak = "https://sso.example.com/realms/trilium";
            expect(await discoveryOutcome(keycloak, "https://evil.example.com/realms/trilium"))
                .toBe("OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED");
            expect(await discoveryOutcome(keycloak, "https://sso.example.com/realms/other"))
                .toBe("OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED");

            // Authentik's "global" issuer mode, where every provider reports the instance root while the
            // document is still only served under the per-application path. Out of reach of trailing-slash
            // tolerance — it needs the issuer configured as an explicit `.well-known` URL instead.
            expect(await discoveryOutcome("https://sso.example.com/application/o/trilium-app/", "https://sso.example.com/"))
                .toBe("OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED");
        });

        /**
         * The fix: since only the provider knows which spelling it advertises, the trailing slash is
         * reconciled against the discovery document rather than normalised in either direction.
         */
        describe("reconcileIssuerBaseUrl", () => {
            it("adopts the advertised spelling when it differs only by a trailing slash", () => {
                // Authentik: user omitted the slash the provider advertises.
                expect(reconcileIssuerBaseUrl(
                    "https://sso.example.com/application/o/trilium-app",
                    "https://sso.example.com/application/o/trilium-app/"
                )).toBe("https://sso.example.com/application/o/trilium-app/");

                // Keycloak: the mirror image, user added a slash the provider does not advertise.
                expect(reconcileIssuerBaseUrl(
                    "https://sso.example.com/realms/trilium/",
                    "https://sso.example.com/realms/trilium"
                )).toBe("https://sso.example.com/realms/trilium");
            });

            it("leaves an already-matching issuer untouched", () => {
                // Including the origin-only case, where both spellings already normalise to the same href.
                expect(reconcileIssuerBaseUrl("https://auth.example.com:9091", "https://auth.example.com:9091/"))
                    .toBe("https://auth.example.com:9091");
                expect(reconcileIssuerBaseUrl("https://sso.example.com/realms/trilium", "https://sso.example.com/realms/trilium"))
                    .toBe("https://sso.example.com/realms/trilium");
            });

            it("keeps the configured issuer when the difference is more than a trailing slash", () => {
                // A document claiming a different host/path must not be able to move the expected issuer;
                // returning the configured value leaves openid-client's check to reject the round-trip.
                const configured = "https://sso.example.com/realms/trilium";
                expect(reconcileIssuerBaseUrl(configured, "https://evil.example.com/realms/trilium")).toBe(configured);
                expect(reconcileIssuerBaseUrl(configured, "https://sso.example.com/realms/other")).toBe(configured);
                expect(reconcileIssuerBaseUrl(configured, "http://sso.example.com/realms/trilium")).toBe(configured);
                // Authentik's "global" issuer mode — a real difference, so still out of scope here.
                expect(reconcileIssuerBaseUrl("https://sso.example.com/application/o/trilium-app/", "https://sso.example.com/"))
                    .toBe("https://sso.example.com/application/o/trilium-app/");
            });

            it("keeps the configured issuer when the document carries no usable issuer", () => {
                const configured = "https://sso.example.com/realms/trilium";
                expect(reconcileIssuerBaseUrl(configured, undefined)).toBe(configured);
                expect(reconcileIssuerBaseUrl(configured, "")).toBe(configured);
                expect(reconcileIssuerBaseUrl(configured, 42)).toBe(configured);
                // Unparseable on either side falls back rather than substituting a guess.
                expect(reconcileIssuerBaseUrl(configured, "not a url")).toBe(configured);
                expect(reconcileIssuerBaseUrl("not a url", "https://sso.example.com/")).toBe("not a url");
            });

            it("closes the loop: the reconciled issuer is what reaches express-openid-connect", async () => {
                setOauthConfig(true);
                mfa.oauthIssuerBaseUrl = "https://sso.example.com/application/o/trilium-app";
                const advertised = "https://sso.example.com/application/o/trilium-app/";

                const reconciled = reconcileIssuerBaseUrl(mfa.oauthIssuerBaseUrl, advertised);
                const { issuerBaseURL } = openID.generateOAuthConfig(false, reconciled);

                expect(issuerBaseURL).toBe(advertised);
                // ...and that value is one openid-client accepts, which is the whole point: the raw
                // config value fails the very same check (see the sibling cases above).
                expect(await discoveryOutcome(issuerBaseURL, advertised)).toBe("accepted");
            });
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
    /** Stands in for the issuer the discovery probe settled on, distinct from any configured value. */
    const PROBED_ISSUER = "https://issuer.example.com/probed/";

    function setup() {
        let configured = false;

        const oidcHandler = vi.fn(((_req, _res, next) => next()) as RequestHandler);
        const buildAuth = vi.fn(() => oidcHandler);
        const probeDiscovery = vi.fn().mockResolvedValue({
            endSessionSupported: false,
            issuerBaseUrl: PROBED_ISSUER,
            idTokenSigningAlg: "RS256",
            metadataAvailable: true
        });
        const generateOAuthConfig = vi.fn((endSessionSupported: boolean) => ({ endSessionSupported }) as never);
        const isConfigured = vi.fn(() => configured);

        const middleware = createReactiveOidcMiddleware({
            isConfigured,
            probeDiscovery,
            generateOAuthConfig,
            buildAuth
        });

        return {
            middleware,
            oidcHandler,
            buildAuth,
            probeDiscovery,
            generateOAuthConfig,
            isConfigured,
            setConfigured: (value: boolean) => { configured = value; }
        };
    }

    async function run(middleware: RequestHandler, url = "/authenticate") {
        const next = vi.fn() as unknown as NextFunction;
        // A failed round-trip redirects back to the app root and flags the session, so both have to be
        // present for the middleware to drive them. `path` mirrors Express's query-stripped getter,
        // which decides whether a failure is answered with a redirect or handed to the error chain.
        const [path] = url.split("?");
        const req = { method: "GET", url, path, session: {} } as ExpressRequest;
        const res = { headersSent: false, redirect: vi.fn() } as unknown as ExpressResponse;
        await middleware(req, res, next);
        return { next, req, res, redirect: res.redirect as unknown as ReturnType<typeof vi.fn> };
    }

    it("passes through without building the OIDC handler when OAuth is not selected", async () => {
        const t = setup(); // starts unconfigured

        const { next } = await run(t.middleware);

        expect(next).toHaveBeenCalledOnce();
        expect(t.buildAuth).not.toHaveBeenCalled();
        expect(t.oidcHandler).not.toHaveBeenCalled();
        // No work is done while OAuth is unselected — not even the discovery probe.
        expect(t.probeDiscovery).not.toHaveBeenCalled();
    });

    it("builds and delegates to the OIDC handler when OAuth is selected", async () => {
        const t = setup();
        t.setConfigured(true);

        const { req, res, next } = await run(t.middleware);

        expect(t.probeDiscovery).toHaveBeenCalledOnce();
        expect(t.generateOAuthConfig).toHaveBeenCalledWith(false, PROBED_ISSUER, "RS256");
        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledWith(req, res, expect.any(Function));
        // The wrapper must hand off to the OIDC handler and NOT call next() itself — calling it again
        // after the handler already drove the request double-invokes the pipeline ("Cannot set headers
        // after they are sent"). Exactly one next() (the one the handler makes) must reach the chain.
        expect(next).toHaveBeenCalledOnce();
    });

    /**
     * A probe that couldn't reach the issuer returns fallbacks, not answers — and `auth()` performs no
     * discovery of its own (it only validates config and builds a router), so the build succeeds and
     * nothing downstream notices. Caching that would freeze the RS256 fallback into the config object
     * for the life of the process: a provider signing EdDSA would then reject every valid ID token until
     * a restart, re-creating the very failure this resolution exists to prevent. The library recovers
     * from the same blip by itself, so the handler must be rebuilt rather than pinned.
     */
    it("does not cache a handler built without the provider's discovery document", async () => {
        const t = setup();
        t.probeDiscovery.mockResolvedValueOnce({
            endSessionSupported: false,
            issuerBaseUrl: PROBED_ISSUER,
            idTokenSigningAlg: "RS256",
            metadataAvailable: false
        });
        t.probeDiscovery.mockResolvedValue({
            endSessionSupported: true,
            issuerBaseUrl: PROBED_ISSUER,
            idTokenSigningAlg: "EdDSA",
            metadataAvailable: true
        });
        t.setConfigured(true);

        // The degraded build still serves its own request rather than failing it — a blip must not break
        // a sign-in the library itself may well complete.
        await run(t.middleware);
        expect(t.oidcHandler).toHaveBeenCalledOnce();
        expect(t.generateOAuthConfig).toHaveBeenLastCalledWith(false, PROBED_ISSUER, "RS256");

        // Once discovery recovers, the real algorithm takes effect without a restart...
        await run(t.middleware);
        expect(t.probeDiscovery).toHaveBeenCalledTimes(2);
        expect(t.generateOAuthConfig).toHaveBeenLastCalledWith(true, PROBED_ISSUER, "EdDSA");

        // ...and that build, made from a document that was actually read, is the one that gets cached.
        await run(t.middleware);
        expect(t.probeDiscovery).toHaveBeenCalledTimes(2);
        expect(t.buildAuth).toHaveBeenCalledTimes(2);
    });

    it("builds the underlying handler only once across requests (cached)", async () => {
        const t = setup();
        t.setConfigured(true);

        await run(t.middleware);
        await run(t.middleware);

        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.probeDiscovery).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledTimes(2);
    });

    it("passes every discovery-probe result into the OAuth config", async () => {
        const t = setup();
        // The issuer reaching express-openid-connect is the probe's, not whatever sits in config — that
        // indirection is what lets a trailing-slash difference be reconciled (#10695). The signing
        // algorithm travels the same way, so a non-RS256 provider is honoured (discussion 6318).
        t.probeDiscovery.mockResolvedValue({
            endSessionSupported: true,
            issuerBaseUrl: "https://sso.example.com/application/o/trilium-app/",
            idTokenSigningAlg: "EdDSA",
            metadataAvailable: true
        });
        t.setConfigured(true);

        await run(t.middleware);

        expect(t.generateOAuthConfig).toHaveBeenCalledWith(true, "https://sso.example.com/application/o/trilium-app/", "EdDSA");
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
        type Probe = {
            endSessionSupported: boolean;
            issuerBaseUrl: string;
            idTokenSigningAlg: string;
            metadataAvailable: boolean;
        };
        let resolveProbe: (value: Probe) => void = () => {};
        t.probeDiscovery.mockReturnValue(new Promise<Probe>((resolve) => { resolveProbe = resolve; }));

        const first = run(t.middleware);
        const second = run(t.middleware);
        resolveProbe({
            endSessionSupported: false,
            issuerBaseUrl: PROBED_ISSUER,
            idTokenSigningAlg: "RS256",
            metadataAvailable: true
        });
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
        t.probeDiscovery.mockRejectedValueOnce(new Error("transient discovery failure"));

        // The failure is reported to the user via the redirect-and-flag path rather than thrown at the
        // generic error handler, which would answer this full-page navigation with raw JSON.
        const failed = await run(t.middleware);
        expect(failed.redirect).toHaveBeenCalledWith("/");
        expect(failed.req.session.ssoConnectionFailed).toContain("transient discovery failure");
        expect(t.oidcHandler).not.toHaveBeenCalled();

        // Second request: the probe succeeds and the handler is finally built and delegated to.
        const { req, res } = await run(t.middleware);
        expect(t.buildAuth).toHaveBeenCalledOnce();
        expect(t.oidcHandler).toHaveBeenCalledWith(req, res, expect.any(Function));
    });

    // The provider round-trip failing outright (unreachable host, untrusted TLS certificate, token
    // exchange error) used to fall through to the generic JSON error handler, stranding the user on a
    // `{"message":"fetch failed"}` page mid-way through connecting an account.
    it("redirects back to the app root and flags the session when the round-trip fails", async () => {
        const t = setup();
        t.setConfigured(true);
        // express-openid-connect reports a broken round-trip through next(err), not by rejecting. The
        // shape mirrors undici's: an opaque top-level message with the real reason nested in `.cause`.
        const tlsFailure = Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
        t.oidcHandler.mockImplementation(((_req, _res, next) =>
            next(new Error("fetch failed", { cause: tlsFailure }))) as RequestHandler);

        const { req, redirect, next } = await run(t.middleware);

        expect(redirect).toHaveBeenCalledWith("/");
        // The detail travels to the client verbatim, so the actionable reason buried in the cause chain
        // reaches the user rather than only the opaque top-level "fetch failed".
        expect(req.session.ssoConnectionFailed).toBe("fetch failed ← caused by: self-signed certificate [DEPTH_ZERO_SELF_SIGNED_CERT]");
        // The error must not also continue down the chain, or Express would answer the request twice.
        expect(next).not.toHaveBeenCalled();
    });

    // The detail's presence is what marks the failure downstream, so an error that describes to nothing
    // must still produce a non-empty string — otherwise the client would read it as "no failure" and the
    // user would land back on the app root with no explanation at all.
    it("still records a detail for an error that describes to nothing", async () => {
        const t = setup();
        t.setConfigured(true);
        // An object with neither a message nor any system/OAuth field — describeError yields null for it.
        t.oidcHandler.mockImplementation(((_req, _res, next) => next({})) as RequestHandler);

        const { req, redirect } = await run(t.middleware);

        expect(redirect).toHaveBeenCalledWith("/");
        expect(req.session.ssoConnectionFailed).toBeTruthy();
    });

    it("falls back to a generic detail when the thrown value stringifies to nothing", async () => {
        const t = setup();
        t.setConfigured(true);
        // A thrown empty string reaches failRoundTrip through the init catch (the round-trip wrapper
        // treats falsy as "no error"). describeError yields null and String() yields "" for it, so
        // only the final fallback keeps the session marker non-empty — and its presence is what marks
        // the failure downstream.
        t.probeDiscovery.mockRejectedValueOnce("");

        const { req, redirect } = await run(t.middleware);

        expect(redirect).toHaveBeenCalledWith("/");
        expect(req.session.ssoConnectionFailed).toBe("unknown error");
    });

    // This middleware is mounted ahead of every route, so a failed lazy init is reached by ordinary
    // traffic too. Redirecting those would hand an XHR a 302 to HTML where it expects JSON, so only the
    // provider round-trip — a full-page navigation — is answered that way.
    it("hands non-navigation requests to the error chain instead of redirecting", async () => {
        const t = setup();
        t.setConfigured(true);
        const failure = new Error("fetch failed");
        t.oidcHandler.mockImplementation(((_req, _res, next) => next(failure)) as RequestHandler);

        const { req, redirect, next } = await run(t.middleware, "/api/notes/root");

        expect(redirect).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(failure);
        expect(req.session.ssoConnectionFailed).toBeUndefined();
    });

    // The redirect target is itself covered by this middleware. A transient failure self-heals (the init
    // promise is reset, so the next request retries), but a persistent one — a malformed oauthBaseUrl
    // that auth() rejects every time — would bounce "/" to "/" until the browser gave up, turning a JSON
    // error that named the bad config into an opaque ERR_TOO_MANY_REDIRECTS.
    it("does not redirect the app root to itself", async () => {
        const t = setup();
        t.setConfigured(true);
        const failure = new Error("invalid config");
        t.probeDiscovery.mockRejectedValue(failure);

        const { redirect, next } = await run(t.middleware, "/");

        expect(redirect).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(failure);
    });

    // The callback carries ?code=&state=, so the guard has to compare against the query-stripped path.
    it("still redirects the callback when it arrives with query parameters", async () => {
        const t = setup();
        t.setConfigured(true);
        t.oidcHandler.mockImplementation(((_req, _res, next) => next(new Error("token exchange failed"))) as RequestHandler);

        const { req, redirect } = await run(t.middleware, "/callback?code=abc&state=xyz");

        expect(redirect).toHaveBeenCalledWith("/");
        expect(req.session.ssoConnectionFailed).toContain("token exchange failed");
    });

    // Once the library has begun answering (e.g. it already started the redirect to the provider), we
    // can't redirect on top of it — the error has to go to Express instead of causing a double response.
    it("defers to the error chain when the response has already started", async () => {
        const t = setup();
        t.setConfigured(true);
        const failure = new Error("fetch failed");
        t.oidcHandler.mockImplementation(((_req, res, next) => {
            (res as { headersSent: boolean }).headersSent = true;
            next(failure);
        }) as RequestHandler);

        const { req, redirect, next } = await run(t.middleware);

        expect(redirect).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(failure);
        expect(req.session.ssoConnectionFailed).toBeUndefined();
    });
});

/**
 * Replays what a provider's token endpoint actually receives for a given client authentication method,
 * driving the real openid-client encoders rather than re-implementing them.
 *
 * `percentDecodes` models the one behavioural split that matters. oauth4webapi always percent-encodes
 * the Basic credentials per RFC 6749 §2.3.1, so what the provider ends up with depends entirely on
 * whether it decodes them again:
 *
 * - `true` — a spec-compliant provider (Authelia/fosite, Keycloak). Basic round-trips correctly.
 * - `false` — Rack/Doorkeeper, i.e. GitLab: it base64-decodes the header and splits on ":" but never
 *   percent-decodes, so it compares against a corrupted secret. That asymmetry is the bug behind #10585.
 *
 * `client_secret_post` is unaffected either way: the credentials ride in the form body, which every
 * provider form-decodes as a matter of course.
 */
function credentialsAtTokenEndpoint(
    method: "client_secret_basic" | "client_secret_post",
    clientId: string,
    clientSecret: string,
    { percentDecodes = false } = {}
) {
    const headers = new Headers();
    const body = new URLSearchParams();
    const applyAuth = method === "client_secret_post"
        ? ClientSecretPost(clientSecret)
        : ClientSecretBasic(clientSecret);
    applyAuth({} as never, { client_id: clientId } as never, body, headers);

    const authorization = headers.get("authorization");
    if (authorization) {
        const decoded = Buffer.from(authorization.replace(/^Basic /, ""), "base64").toString();
        const separator = decoded.indexOf(":");
        const asReceived = (value: string) => (percentDecodes ? decodeURIComponent(value) : value);
        return {
            clientId: asReceived(decoded.slice(0, separator)),
            clientSecret: asReceived(decoded.slice(separator + 1))
        };
    }

    return { clientId: body.get("client_id"), clientSecret: body.get("client_secret") };
}

/**
 * Replays express-openid-connect's discovery step for a given (configured issuer, advertised issuer)
 * pair, driving the real openid-client rather than re-implementing its comparison — the same approach
 * {@link credentialsAtTokenEndpoint} takes for the token endpoint.
 *
 * The provider is stubbed at the transport layer via openid-client's `customFetch`, so no network and no
 * container is involved: every request is answered with a discovery document advertising
 * `advertisedIssuer`. That is enough, because the failure in #10695 is a pure string comparison the
 * library performs *after* the document is fetched, not a routing or connectivity problem. The document
 * is served for whatever URL is requested, matching how Authentik answers the `.well-known` path
 * regardless of whether the caller included a trailing slash.
 *
 * Returns `"accepted"` or the thrown error's code, so a test reads as the outcome a user would get.
 */
async function discoveryOutcome(configuredIssuer: string, advertisedIssuer: string) {
    const base = advertisedIssuer.replace(/\/$/, "");
    const serveMetadata: CustomFetch = async () => new Response(
        JSON.stringify({
            issuer: advertisedIssuer,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            jwks_uri: `${base}/jwks`,
            response_types_supported: ["code"]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
    );

    try {
        await discovery(new URL(configuredIssuer), "client-id", {}, undefined, {
            [customFetch]: serveMetadata
        });
        return "accepted";
    } catch (error) {
        return (error as { code?: string })?.code ?? String(error);
    }
}

/** The issuer the {@link eddsaIdTokenOutcome} stub provider answers as. */
const EDDSA_ISSUER = "https://issuer.example.com";
const EDDSA_CLIENT_ID = "client-id";

/**
 * Runs a full authorization-code exchange against a stub provider that signs its ID token with Ed25519,
 * with the client registered as expecting `expectedAlg` — which is precisely what express-openid-connect
 * hands openid-client as `id_token_signed_response_alg`. Returns `"accepted"`, or the error message a
 * user would see in the log.
 *
 * Like {@link discoveryOutcome} this drives the real openid-client over a `customFetch` transport, so the
 * assertions are about the library's actual behaviour rather than a re-implementation of it — but here
 * the token is genuinely signed and genuinely verified against the served JWKS, so a wrong `expectedAlg`
 * fails for the real reason instead of a stubbed one. Ed25519 comes from node's own crypto, so no
 * dependency (and no Pocket ID container) is needed to reproduce the report.
 */
async function eddsaIdTokenOutcome(expectedAlg: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "ed25519-1", alg: "EdDSA", use: "sig" }] };

    const now = Math.floor(Date.now() / 1000);
    const idToken = signEdDsaJwt(privateKey, {
        iss: EDDSA_ISSUER,
        aud: EDDSA_CLIENT_ID,
        sub: "user-1",
        iat: now,
        exp: now + 300
    });

    const json = (body: unknown) => new Response(
        JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }
    );
    // One transport serves all three legs of the exchange: discovery, the JWKS the signature is verified
    // against, and the token endpoint that returns the signed ID token.
    const serveProvider: CustomFetch = async (url) => {
        const path = new URL(url.toString()).pathname;
        if (path.endsWith("/jwks")) {
            return json(jwks);
        }
        if (path.endsWith("/token")) {
            return json({ access_token: "access-token", token_type: "bearer", id_token: idToken });
        }
        return json({
            issuer: EDDSA_ISSUER,
            authorization_endpoint: `${EDDSA_ISSUER}/authorize`,
            token_endpoint: `${EDDSA_ISSUER}/token`,
            jwks_uri: `${EDDSA_ISSUER}/jwks`,
            response_types_supported: ["code"],
            // The Pocket ID shape once its key has been rotated to Ed25519: RS256 is not on offer at all.
            id_token_signing_alg_values_supported: ["EdDSA"]
        });
    };

    const configuration = await discovery(
        new URL(EDDSA_ISSUER),
        EDDSA_CLIENT_ID,
        { id_token_signed_response_alg: expectedAlg },
        ClientSecretPost("client-secret"),
        { [customFetch]: serveProvider }
    );

    try {
        await authorizationCodeGrant(configuration, new URL("https://app.example.com/callback?code=auth-code"), {});
        return "accepted";
    } catch (error) {
        // openid-client reports this as a bare "invalid response encountered" and puts the actual reason
        // on `.cause`. describeError is what unwraps that chain for the log line and the toast the user
        // gets (see failRoundTrip), so asserting on its output pins the message they would actually see.
        return describeError(error) ?? String(error);
    }
}

/** Signs `claims` as a compact EdDSA JWS. Node signs Ed25519 with a null digest (RFC 8032). */
function signEdDsaJwt(privateKey: KeyObject, claims: Record<string, unknown>) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const signingInput = `${encode({ alg: "EdDSA", typ: "JWT", kid: "ed25519-1" })}.${encode(claims)}`;
    const signature = sign(null, Buffer.from(signingInput), privateKey).toString("base64url");
    return `${signingInput}.${signature}`;
}
