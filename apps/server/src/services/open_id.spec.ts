import { cls, options } from "@triliumnext/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import config from "./config.js";
import openIDEncryption from "./encryption/open_id_encryption.js";
import openID from "./open_id.js";
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

    it("isOpenIDEnabled requires full config and mfaMethod=oauth", () => {
        setOauthConfig(true);
        cls.init(() => options.setOption("mfaMethod", "totp"));
        expect(openID.isOpenIDEnabled()).toBe(false); // method not oauth

        cls.init(() => options.setOption("mfaMethod", "oauth"));
        expect(openID.isOpenIDEnabled()).toBe(true);
        expect(openID.getOAuthStatus().missingVars).toEqual([]);
    });

    it("exposes issuer name/icon from config", () => {
        setOauthConfig(true);
        expect(openID.getSSOIssuerName()).toBe("Acme");
        expect(openID.getSSOIssuerIcon()).toBe("icon.png");
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

    it("clearSavedUser empties user_data and clears the option", () => {
        const result = cls.init(() => openID.clearSavedUser());
        expect(result.success).toBe(true);
        expect(openID.isUserSaved()).toBe(false);
        // clearSavedUser sets the option to a falsy value
        expect(options.getOptionOrNull("userSubjectIdentifierSaved")).toBeFalsy();
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

        it("wires routes and credentials from config", () => {
            const cfg = buildConfig();
            expect(cfg.baseURL).toBe("https://app.example.com");
            expect(cfg.clientID).toBe("client-id");
            expect(cfg.routes.callback).toBe("/callback");
            expect(typeof cfg.afterCallback).toBe("function");
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
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const session = { marker: 2 } as never;
            const result = await cfg.afterCallback({ oidc: { user: undefined } } as never, {} as never, session);
            expect(result).toBe(session);
            logSpy.mockRestore();
        });

        it("saves the user and sets the session login flags", async () => {
            cls.init(() => {
                sql.transactional(() => sql.execute("DELETE FROM user_data"));
            });
            const cfg = buildConfig();
            const saveSpy = vi.spyOn(openIDEncryption, "saveUser").mockReturnValue(true);
            const req = {
                oidc: { user: { sub: "sub-1", name: "Alice", email: "alice@example.com" } },
                session: {} as Record<string, unknown>
            } as never;
            const session = { marker: 3 } as never;

            const result = await cfg.afterCallback(req, {} as never, session);

            expect(saveSpy).toHaveBeenCalledWith("sub-1", "Alice", "alice@example.com");
            expect((req as { session: { loggedIn: boolean } }).session.loggedIn).toBe(true);
            expect(result).toBe(session);
        });
    });
});
