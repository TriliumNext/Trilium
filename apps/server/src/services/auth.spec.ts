import { attributes, options, password as passwordService, password_encryption as passwordEncryptionService } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import auth, { refreshAuth } from "./auth";
import { cls } from "@triliumnext/core";
import config from "./config";
import { markAsInternalElectronRequest } from "./electron_request";
import etapiTokens from "./etapi_tokens";
import openID from "./open_id";
import sqlInit from "./sql_init";
import totp from "./totp";

let app: Application;

describe("Auth", () => {
    beforeAll(async () => {
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
    });

    describe("Auth", () => {
        beforeAll(() => {
            config.General.noAuthentication = false;
            refreshAuth();
        });

        it("goes to login and asks for TOTP if enabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "true");
                options.setOption("mfaMethod", "totp");
                options.setOption("totpVerificationHash", "hi");
            });
            const response = await supertest(app)
                .get("/")
                .redirects(1)
                .expect(200);
            expect(response.text).toContain(`id="totpToken"`);
        });

        it("goes to login and doesn't ask for TOTP is disabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "false");
            });
            const response = await supertest(app)
                .get("/")
                .redirects(1)
                .expect(200);
            expect(response.text).not.toContain(`id="totpToken"`);
        });
    });

    describe("No auth", () => {
        beforeAll(() => {
            config.General.noAuthentication = true;
            refreshAuth();
        });

        it("doesn't ask for authentication when disabled, even if TOTP is enabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "true");
                options.setOption("mfaMethod", "totp");
                options.setOption("totpVerificationHash", "hi");
            });
            await supertest(app)
                .get("/")
                .expect(200);
        });

        it("doesn't ask for authentication when disabled, with TOTP disabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "false");
            });
            await supertest(app)
                .get("/")
                .expect(200);
        });
    });

    describe("middleware (direct invocation)", () => {
        function makeRes() {
            const res = {
                statusCode: 0 as number,
                headers: {} as Record<string, string>,
                body: undefined as unknown,
                redirectedTo: undefined as string | undefined,
                setHeader(k: string, v: string) {
                    res.headers[k] = v;
                    return res;
                },
                status(c: number) {
                    res.statusCode = c;
                    return res;
                },
                json(o: unknown) {
                    res.body = o;
                    return res;
                },
                send(o: unknown) {
                    res.body = o;
                    return res;
                },
                redirect(loc: string) {
                    res.redirectedTo = loc;
                }
            };
            return res;
        }

        function makeReq(overrides: Record<string, unknown> = {}) {
            return {
                method: "GET",
                path: "/test",
                ip: "127.0.0.1",
                sessionID: "sid",
                headers: {},
                session: {},
                ...overrides
            } as never;
        }

        beforeAll(() => {
            config.General.noAuthentication = false;
            refreshAuth();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("checkAuth lets the request through when the DB is not initialized", () => {
            const spy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const next = vi.fn();
            auth.checkAuth(makeReq(), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
            spy.mockRestore();
        });

        it("checkAuth lets internal electron requests through", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            const req = makeReq();
            markAsInternalElectronRequest(req as object);
            const next = vi.fn();
            auth.checkAuth(req, makeRes() as never, next);
            expect(next).toHaveBeenCalled();
        });

        it("checkAuth redirects to login when not logged in (no bare-domain redirect)", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            cls.init(() => options.setOption("redirectBareDomain", "false"));
            const res = makeRes();
            auth.checkAuth(makeReq({ session: { loggedIn: false } }), res as never, vi.fn());
            expect(res.redirectedTo).toBe("login");
        });

        it("checkAuth honours redirectBareDomain: 404 when no shareRoot, else redirects to share", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            cls.init(() => options.setOption("redirectBareDomain", "true"));

            const labelSpy = vi.spyOn(attributes, "getNotesWithLabel").mockReturnValue([]);
            const res404 = makeRes();
            auth.checkAuth(makeReq({ session: { loggedIn: false } }), res404 as never, vi.fn());
            expect(res404.statusCode).toBe(404);

            labelSpy.mockReturnValue([{ noteId: "x" } as never]);
            const resShare = makeRes();
            auth.checkAuth(makeReq({ session: { loggedIn: false } }), resShare as never, vi.fn());
            expect(resShare.redirectedTo).toBe("share");

            cls.init(() => options.setOption("redirectBareDomain", "false"));
        });

        it("checkAuth destroys the session and redirects when auth state changed", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            const destroy = vi.fn((cb: (err?: Error) => void) => cb());
            const res = makeRes();
            auth.checkAuth(
                makeReq({
                    session: { loggedIn: true, lastAuthState: { totpEnabled: false, ssoEnabled: false }, destroy }
                }),
                res as never,
                vi.fn()
            );
            expect(destroy).toHaveBeenCalled();
            expect(res.redirectedTo).toBe("login");

            // also exercise the destroy-error logging branch
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const destroyErr = vi.fn((cb: (err?: Error) => void) => cb(new Error("boom")));
            auth.checkAuth(
                makeReq({
                    session: { loggedIn: true, lastAuthState: { totpEnabled: false, ssoEnabled: false }, destroy: destroyErr }
                }),
                makeRes() as never,
                vi.fn()
            );
            expect(errSpy).toHaveBeenCalled();
            errSpy.mockRestore();
        });

        it("checkAuth handles the SSO-enabled path (authenticated vs not)", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(true);
            const base = {
                loggedIn: true,
                lastAuthState: { totpEnabled: false, ssoEnabled: true }
            };

            const nextOk = vi.fn();
            auth.checkAuth(
                makeReq({ session: { ...base }, oidc: { isAuthenticated: () => true } }),
                makeRes() as never,
                nextOk
            );
            expect(nextOk).toHaveBeenCalled();

            const resRedirect = makeRes();
            auth.checkAuth(
                makeReq({ session: { ...base }, oidc: { isAuthenticated: () => false } }),
                resRedirect as never,
                vi.fn()
            );
            expect(resRedirect.redirectedTo).toBe("login");
        });

        it("checkAuth falls through to next on the normal logged-in path", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            const next = vi.fn();
            auth.checkAuth(
                makeReq({ session: { loggedIn: true, lastAuthState: { totpEnabled: false, ssoEnabled: false } } }),
                makeRes() as never,
                next
            );
            expect(next).toHaveBeenCalled();
        });

        it("checkApiAuthOrElectron rejects unauthenticated and allows internal electron", () => {
            const res = makeRes();
            auth.checkApiAuthOrElectron(makeReq({ session: { loggedIn: false } }), res as never, vi.fn());
            expect(res.statusCode).toBe(401);

            const req = makeReq({ session: { loggedIn: false } });
            markAsInternalElectronRequest(req as object);
            const next = vi.fn();
            auth.checkApiAuthOrElectron(req, makeRes() as never, next);
            expect(next).toHaveBeenCalled();
        });

        it("checkApiAuthOrElectron passes through when DB not initialized", () => {
            const spy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const next = vi.fn();
            auth.checkApiAuthOrElectron(makeReq(), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
            spy.mockRestore();
        });

        it("checkApiAuth handles electron, unauthenticated, and authenticated paths", () => {
            // DB not initialized -> next
            const dbSpy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const next1 = vi.fn();
            auth.checkApiAuth(makeReq(), makeRes() as never, next1);
            expect(next1).toHaveBeenCalled();
            dbSpy.mockRestore();

            // internal electron -> next
            const electronReq = makeReq();
            markAsInternalElectronRequest(electronReq as object);
            const next2 = vi.fn();
            auth.checkApiAuth(electronReq, makeRes() as never, next2);
            expect(next2).toHaveBeenCalled();

            // not logged in -> reject
            const res = makeRes();
            auth.checkApiAuth(makeReq({ session: { loggedIn: false } }), res as never, vi.fn());
            expect(res.statusCode).toBe(401);

            // logged in -> next
            const next3 = vi.fn();
            auth.checkApiAuth(makeReq({ session: { loggedIn: true } }), makeRes() as never, next3);
            expect(next3).toHaveBeenCalled();
        });

        it("checkAppInitialized always calls next", () => {
            const next = vi.fn();
            auth.checkAppInitialized(makeReq(), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
        });

        it("checkPasswordSet / checkPasswordNotSet branch on whether a password is set", () => {
            // password set
            const setSpy = vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);
            const nextSet = vi.fn();
            auth.checkPasswordSet(makeReq(), makeRes() as never, nextSet);
            expect(nextSet).toHaveBeenCalled();

            const resNotSet = makeRes();
            auth.checkPasswordNotSet(makeReq(), resNotSet as never, vi.fn());
            expect(resNotSet.redirectedTo).toBe("login");
            setSpy.mockRestore();

            // password not set
            const unsetSpy = vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(false);
            const resSet = makeRes();
            auth.checkPasswordSet(makeReq(), resSet as never, vi.fn());
            expect(resSet.redirectedTo).toBe("set-password");

            const nextNotSet = vi.fn();
            auth.checkPasswordNotSet(makeReq(), makeRes() as never, nextNotSet);
            expect(nextNotSet).toHaveBeenCalled();
            unsetSpy.mockRestore();
        });

        it("checkAppNotInitialized rejects when initialized, else calls next", () => {
            const res = makeRes();
            auth.checkAppNotInitialized(makeReq(), res as never, vi.fn());
            expect(res.statusCode).toBe(401);

            const spy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const next = vi.fn();
            auth.checkAppNotInitialized(makeReq(), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
            spy.mockRestore();
        });

        it("checkEtapiToken accepts a valid token header and rejects an invalid one", () => {
            const { authToken } = cls.init(() => etapiTokens.createToken("auth-spec-token"));
            const next = vi.fn();
            auth.checkEtapiToken(makeReq({ headers: { authorization: authToken } }), makeRes() as never, next);
            expect(next).toHaveBeenCalled();

            const res = makeRes();
            auth.checkEtapiToken(makeReq({ headers: { authorization: "bogus_token" } }), res as never, vi.fn());
            expect(res.statusCode).toBe(401);
        });

        it("checkCredentials walks DB/password/header/verification branches", () => {
            // DB not initialized -> 400
            const dbSpy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const res1 = makeRes();
            auth.checkCredentials(makeReq(), res1 as never, vi.fn());
            expect(res1.statusCode).toBe(400);
            dbSpy.mockRestore();

            // password not set -> 400
            const unsetSpy = vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(false);
            const res2 = makeRes();
            auth.checkCredentials(makeReq(), res2 as never, vi.fn());
            expect(res2.statusCode).toBe(400);
            unsetSpy.mockRestore();

            // password set from here on
            vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);

            // non-string trilium-cred header -> 400
            const res3 = makeRes();
            auth.checkCredentials(makeReq({ headers: { "trilium-cred": ["a", "b"] } }), res3 as never, vi.fn());
            expect(res3.statusCode).toBe(400);

            // wrong password -> 401
            const verifySpy = vi.spyOn(passwordEncryptionService, "verifyPassword").mockReturnValue(false as never);
            const cred = Buffer.from("user:wrongpass").toString("base64");
            const res4 = makeRes();
            auth.checkCredentials(makeReq({ headers: { "trilium-cred": cred } }), res4 as never, vi.fn());
            expect(res4.statusCode).toBe(401);
            // The username before the colon is stripped; only the password is verified.
            expect(verifySpy).toHaveBeenLastCalledWith("wrongpass");

            // correct password (no colon in decoded cred path also exercised) -> next
            verifySpy.mockReturnValue(true as never);
            const credNoColon = Buffer.from("justpassword").toString("base64");
            const next = vi.fn();
            auth.checkCredentials(makeReq({ headers: { "trilium-cred": credNoColon } }), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
            // No colon → the whole cred is treated as username and the password is "".
            expect(verifySpy).toHaveBeenLastCalledWith("");

            // missing trilium-cred header -> falls back to "" -> next (with verify mocked true)
            const nextNoHeader = vi.fn();
            auth.checkCredentials(makeReq({ headers: {} }), makeRes() as never, nextNoHeader);
            expect(nextNoHeader).toHaveBeenCalled();
        });
    });
}, 60_000);
