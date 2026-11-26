import { cls, date_utils, options } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { generateConfig, Totp } from "time2fa";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import config from "../../src/services/config.js";
import totp from "../../src/services/totp.js";

let app: Application;

const CORRECT_PASSWORD = "demo1234";

// A file of its own: each failed login counts toward the limit of `auth-login.spec.ts`'s app.
describe("etapi/auth/login refusals of the second factor", () => {
    const { secret } = Totp.generateKey({ issuer: "Trilium", user: "spec" });

    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    afterEach(() => {
        cls.init(() => {
            totp.resetTotp();
            for (const name of [ "totpLastUsedStep", "totpWrongCodeCount" ] as const) {
                options.setOption(name, "");
            }
            options.setOption("signInAttemptRecord", "");
        });
    });

    function login(totpToken: string) {
        return supertest(app)
            .post("/etapi/auth/login")
            .send({ tokenName: "test", password: CORRECT_PASSWORD, totpToken });
    }

    it("says why it refuses a right code while codes wait after wrong ones", async () => {
        cls.init(() => {
            options.setOption("mfaMethod", "totp");
            totp.setSecret(secret);
            const wrongCodes = { count: 5, lastAt: date_utils.utcNowDateTime() };
            options.setOption("totpWrongCodeCount", JSON.stringify(wrongCodes));
        });
        const [ code ] = Totp.generatePasscodes({ secret }, generateConfig());

        const response = await login(code).expect(401);
        expect(response.body.code).toBe("WRONG_TOTP");
        expect(response.body.message).toContain("Try again after");
        expect(response.body.authToken).toBeUndefined();
    });

    it("says that a factor which cannot be checked refuses every code", async () => {
        cls.init(() => {
            options.setOption("mfaMethod", "totp");
            totp.setSecret(secret);
            // A sealed value that does not open, as without the key file.
            options.setOption("totpEncryptedSecret", "sealed1:AAAA");
        });

        const response = await login("123456").expect(401);
        expect(response.body.code).toBe("WRONG_TOTP");
        expect(response.body.message).toContain("TRILIUM_RESET_SECOND_FACTOR");
    });
});
