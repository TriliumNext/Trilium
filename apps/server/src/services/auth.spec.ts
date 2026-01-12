import { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { refreshAuth } from "./auth";
import cls from "./cls";
import config from "./config";
import options from "./options";

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
}, 60_000);
