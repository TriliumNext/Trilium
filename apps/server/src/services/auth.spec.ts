import { attributes, options, password as passwordService, password_encryption as passwordEncryptionService } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import auth, { refreshAuth, verifyLoginCredentials } from "./auth";
import { cls } from "@triliumnext/core";
import config from "./config";
import { markAsInternalElectronRequest } from "./electron_request";
import recoveryCodeService from "./encryption/recovery_codes";
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

        it("bootstrap login payload asks for TOTP when enabled", async () => {
            cls.init(() => {
                options.setOption("mfaMethod", "totp");
                options.setOption("totpVerificationHash", "hi");
            });
            // The login screen is rendered client-side now; the server reports the TOTP
            // requirement through the (unauthenticated) bootstrap payload.
            const response = await supertest(app).get("/bootstrap").expect(200);
            expect(response.body.loggedIn).toBe(false);
            expect(response.body.login?.totpEnabled).toBe(true);
        });

        it("bootstrap login payload doesn't ask for TOTP when disabled", async () => {
            cls.init(() => {
                options.setOption("totpVerificationHash", "");
            });
            const response = await supertest(app).get("/bootstrap").expect(200);
            expect(response.body.login?.totpEnabled).toBe(false);
        });
    });

    describe("No auth", () => {
        beforeAll(() => {
            config.General.noAuthentication = true;
            refreshAuth();
        });

        it("doesn't ask for authentication when disabled, even if TOTP is enabled", async () => {
            cls.init(() => {
                options.setOption("mfaMethod", "totp");
                options.setOption("totpVerificationHash", "hi");
            });
            await supertest(app)
                .get("/")
                .expect(200);
        });

        it("doesn't ask for authentication when disabled, with TOTP disabled", async () => {
            cls.init(() => {
                options.setOption("totpVerificationHash", "");
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

        it("checkAuth serves the SPA (next) when not logged in (no bare-domain redirect)", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            cls.init(() => options.setOption("redirectBareDomain", "false"));
            const res = makeRes();
            const next = vi.fn();
            // The login screen is served by the SPA now, so checkAuth falls through.
            auth.checkAuth(makeReq({ session: { loggedIn: false } }), res as never, next);
            expect(next).toHaveBeenCalled();
            expect(res.redirectedTo).toBeUndefined();
        });

        it("checkAuth honours redirectBareDomain: redirects to share when a shareRoot exists, else serves the SPA", () => {
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            vi.spyOn(openID, "isOpenIDEnabled").mockReturnValue(false);
            cls.init(() => options.setOption("redirectBareDomain", "true"));

            // No shareRoot configured: fall through to the SPA login screen instead of a
            // 404 dead-end (#7869).
            const labelSpy = vi.spyOn(attributes, "getNotesWithLabel").mockReturnValue([]);
            const resLogin = makeRes();
            const nextLogin = vi.fn();
            auth.checkAuth(makeReq({ session: { loggedIn: false } }), resLogin as never, nextLogin);
            expect(nextLogin).toHaveBeenCalled();
            expect(resLogin.statusCode).not.toBe(404);

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
            // The set-password screen is now served by the SPA at the root.
            expect(resSet.redirectedTo).toBe(".");

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

        it("checkCredentials walks DB/password/header/verification branches", async () => {
            // DB not initialized -> 400
            const dbSpy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const res1 = makeRes();
            await auth.checkCredentials(makeReq(), res1 as never, vi.fn());
            expect(res1.statusCode).toBe(400);
            dbSpy.mockRestore();

            // password not set -> 400
            const unsetSpy = vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(false);
            const res2 = makeRes();
            await auth.checkCredentials(makeReq(), res2 as never, vi.fn());
            expect(res2.statusCode).toBe(400);
            unsetSpy.mockRestore();

            // password set from here on
            vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);

            // non-string trilium-cred header -> 400
            const res3 = makeRes();
            await auth.checkCredentials(makeReq({ headers: { "trilium-cred": ["a", "b"] } }), res3 as never, vi.fn());
            expect(res3.statusCode).toBe(400);

            // wrong password -> 401. verifyPassword is async, so it's mocked to resolve a
            // boolean and the call is awaited.
            const verifySpy = vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(false as never);
            const cred = Buffer.from("user:wrongpass").toString("base64");
            const res4 = makeRes();
            await auth.checkCredentials(makeReq({ headers: { "trilium-cred": cred } }), res4 as never, vi.fn());
            expect(res4.statusCode).toBe(401);
            // The username before the colon is stripped; only the password is verified.
            expect(verifySpy).toHaveBeenLastCalledWith("wrongpass");

            // correct password (no colon in decoded cred path also exercised) -> next
            verifySpy.mockResolvedValue(true as never);
            const credNoColon = Buffer.from("justpassword").toString("base64");
            const next = vi.fn();
            await auth.checkCredentials(makeReq({ headers: { "trilium-cred": credNoColon } }), makeRes() as never, next);
            expect(next).toHaveBeenCalled();
            // No colon → the whole cred is treated as username and the password is "".
            expect(verifySpy).toHaveBeenLastCalledWith("");

            // missing trilium-cred header -> falls back to "" -> next (with verify mocked true)
            const nextNoHeader = vi.fn();
            await auth.checkCredentials(makeReq({ headers: {} }), makeRes() as never, nextNoHeader);
            expect(nextNoHeader).toHaveBeenCalled();
        });

        // verifyPassword is async, so its resolved value — not the Promise object — must drive
        // the result. These two cases mock it the way it really behaves (resolving a boolean)
        // and await the call, asserting the verification outcome actually gates the response;
        // a synchronous mock would not exercise that.
        it("checkCredentials rejects a password that fails async verification", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(true);
            vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(false as never);

            const cred = Buffer.from("user:wrongpass").toString("base64");
            const res = makeRes();
            const next = vi.fn();

            await auth.checkCredentials(makeReq({ headers: { "trilium-cred": cred } }), res as never, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
        });

        it("checkCredentials calls next when async verification succeeds", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(true);
            vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true as never);

            const cred = Buffer.from("user:correctpass").toString("base64");
            const next = vi.fn();

            await auth.checkCredentials(makeReq({ headers: { "trilium-cred": cred } }), makeRes() as never, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe("verifyLoginCredentials", () => {
        // Any string works — verifyRecoveryCode is mocked, so the actual code format is irrelevant.
        const RECOVERY_CODE = "AAAAAAAAAAAAAAAAAAAAAA==";

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("does not consume a recovery code when the password is wrong", async () => {
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(false as never);
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
            const validateSpy = vi.spyOn(totp, "validateTOTP").mockReturnValue(false);
            const recoverySpy = vi.spyOn(recoveryCodeService, "verifyRecoveryCode").mockReturnValue(true);

            expect(await verifyLoginCredentials("wrong-password", RECOVERY_CODE)).toBe("password");

            // The second factor must never be evaluated when the password is wrong: verifying a
            // recovery code consumes it, so doing so here would burn a single-use code on a login
            // that ultimately fails on the password.
            expect(validateSpy).not.toHaveBeenCalled();
            expect(recoverySpy).not.toHaveBeenCalled();
        });

        it("returns null for a correct password when TOTP is disabled", async () => {
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true as never);
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(false);
            const validateSpy = vi.spyOn(totp, "validateTOTP").mockReturnValue(false);

            expect(await verifyLoginCredentials("correct", "")).toBeNull();
            // With TOTP disabled the second factor is skipped entirely.
            expect(validateSpy).not.toHaveBeenCalled();
        });

        it("returns null for a correct password with a valid TOTP token, without touching recovery codes", async () => {
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true as never);
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
            vi.spyOn(totp, "validateTOTP").mockReturnValue(true);
            const recoverySpy = vi.spyOn(recoveryCodeService, "verifyRecoveryCode").mockReturnValue(false);

            expect(await verifyLoginCredentials("correct", "123456")).toBeNull();
            // A valid TOTP token short-circuits, so recovery codes are never inspected.
            expect(recoverySpy).not.toHaveBeenCalled();
        });

        it("consumes a recovery code only after the password is verified", async () => {
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true as never);
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
            vi.spyOn(totp, "validateTOTP").mockReturnValue(false);
            const recoverySpy = vi.spyOn(recoveryCodeService, "verifyRecoveryCode").mockReturnValue(true);

            expect(await verifyLoginCredentials("correct", RECOVERY_CODE)).toBeNull();
            expect(recoverySpy).toHaveBeenCalledWith(RECOVERY_CODE);
        });

        it("rejects a correct password paired with an invalid second factor", async () => {
            vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true as never);
            vi.spyOn(totp, "isTotpEnabled").mockReturnValue(true);
            vi.spyOn(totp, "validateTOTP").mockReturnValue(false);
            vi.spyOn(recoveryCodeService, "verifyRecoveryCode").mockReturnValue(false);

            expect(await verifyLoginCredentials("correct", "000000")).toBe("totp");
        });
    });
}, 60_000);
