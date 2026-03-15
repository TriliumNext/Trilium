import { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { refreshAuth } from "./auth";
import cls from "./cls";
import config from "./config";
import options from "./options";

let app: Application;

function encodeCred(password: string): string {
    return Buffer.from(`dummy:${password}`).toString("base64");
}

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

    describe("Setup status endpoint", () => {
        it("returns totpEnabled: true when TOTP is enabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "true");
                options.setOption("mfaMethod", "totp");
                options.setOption("totpVerificationHash", "hi");
            });
            const response = await supertest(app)
                .get("/api/setup/status")
                .expect(200);
            expect(response.body.totpEnabled).toBe(true);
        });

        it("returns totpEnabled: false when TOTP is disabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "false");
            });
            const response = await supertest(app)
                .get("/api/setup/status")
                .expect(200);
            expect(response.body.totpEnabled).toBe(false);
        });
    });

    describe("checkCredentials TOTP enforcement", () => {
        beforeAll(() => {
            config.General.noAuthentication = false;
            refreshAuth();
        });

        it("does not require TOTP token when TOTP is disabled", async () => {
            cls.init(() => {
                options.setOption("mfaEnabled", "false");
            });
            // Will still fail with 401 due to wrong password, but NOT because of missing TOTP
            const response = await supertest(app)
                .get("/api/setup/sync-seed")
                .set("trilium-cred", encodeCred("wrongpassword"))
                .expect(401);
            // The error should be about password, not TOTP
            expect(response.text).toContain("Incorrect password");
        });
    });
}, 60_000);

