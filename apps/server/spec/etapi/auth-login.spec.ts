import { cls, options } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { generateConfig, Totp } from "time2fa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import config from "../../src/services/config.js";
import recoveryCodeService from "../../src/services/encryption/recovery_codes.js";
import totp from "../../src/services/totp.js";

let app: Application;

const LOGIN_URL = "/etapi/auth/login";
const CORRECT_PASSWORD = "demo1234";

describe("etapi/auth/login", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    it("issues a token for the correct password", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: CORRECT_PASSWORD, tokenName: "test" })
            .expect(201);

        expect(response.body.authToken).toBeTruthy();
    });

    // verifyPassword is async; this guards that a wrong password is rejected and the
    // async verification result actually gates token issuance.
    it("rejects a wrong password and issues no token", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "definitely-not-the-password", tokenName: "test" })
            .expect(401);

        expect(response.body.code).toBe("WRONG_PASSWORD");
        expect(response.body.authToken).toBeUndefined();
    });

    it("rejects an empty password and issues no token", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "", tokenName: "test" })
            .expect(401);

        expect(response.body.authToken).toBeUndefined();
    });

    it("rejects a missing password and issues no token", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ tokenName: "test" })
            .expect(401);

        expect(response.body.code).toBe("WRONG_PASSWORD");
        expect(response.body.authToken).toBeUndefined();
    });

    // A token must never be issued from a failed login, and even if one were, it must not
    // grant access to data.
    it("does not grant data access from a wrong-password login attempt", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "definitely-not-the-password", tokenName: "test" });

        const token = response.body.authToken;
        // Defense in depth: if any token came back, assert it cannot read the root note.
        if (token) {
            await supertest(app)
                .get("/etapi/notes/root")
                .auth("etapi", token, { type: "basic" })
                .expect(401);
        }
    });
    describe("with TOTP enabled", () => {
        const RECOVERY_CODE = "AAAAAAAAAAAAAAAAAAAAAA==";
        const { secret } = Totp.generateKey({ issuer: "Trilium", user: "spec" });

        beforeAll(() => {
            cls.init(() => {
                options.setOption("mfaMethod", "totp");
                totp.setSecret(secret);
                recoveryCodeService.setRecoveryCodes(RECOVERY_CODE);
            });
        });

        afterAll(() => {
            cls.init(() => {
                totp.resetTotp();
                options.setOption("totpLastUsedStep", "");
            });
        });

        function login(body: Record<string, unknown>) {
            return supertest(app).post(LOGIN_URL).send({ tokenName: "test", ...body });
        }

        it("requires the second factor and checks it after the password", async () => {
            const missing = await login({ password: CORRECT_PASSWORD }).expect(401);
            expect(missing.body.code).toBe("TOTP_REQUIRED");
            expect(missing.body.authToken).toBeUndefined();

            const wrongCode = await login({ password: CORRECT_PASSWORD, totpToken: "000000" }).expect(401);
            expect(wrongCode.body.code).toBe("WRONG_TOTP");
            expect(wrongCode.body.authToken).toBeUndefined();

            // A wrong password is reported as such and does not spend the recovery code.
            const wrongPassword = await login({ password: "wrong", totpToken: RECOVERY_CODE }).expect(401);
            expect(wrongPassword.body.code).toBe("WRONG_PASSWORD");
        });

        it("issues a token for a valid TOTP code, once", async () => {
            const [ code ] = Totp.generatePasscodes({ secret }, generateConfig());

            const response = await login({ password: CORRECT_PASSWORD, totpToken: code }).expect(201);
            expect(response.body.authToken).toBeTruthy();

            const replay = await login({ password: CORRECT_PASSWORD, totpToken: code }).expect(401);
            expect(replay.body.code).toBe("WRONG_TOTP");
        });

        it("issues a token for a recovery code, once", async () => {
            const response = await login({ password: CORRECT_PASSWORD, totpToken: RECOVERY_CODE }).expect(201);
            expect(response.body.authToken).toBeTruthy();

            const replay = await login({ password: CORRECT_PASSWORD, totpToken: RECOVERY_CODE }).expect(401);
            expect(replay.body.code).toBe("WRONG_TOTP");
        });
    });
});
