import { Application } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import config from "../../src/services/config.js";

let app: Application;

// `noAuthentication` is captured at module load in etapi_utils.ts, so it must be set
// before the app (and its ETAPI router) is first imported in this isolated fork.
describe("etapi with noAuthentication enabled", () => {
    beforeAll(async () => {
        config.General.noAuthentication = true;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    afterAll(() => {
        config.General.noAuthentication = false;
    });

    it("rejects logout when the request carries no usable token", async () => {
        const response = await supertest(app).post("/etapi/auth/logout").expect(400);
        expect(response.body.code).toStrictEqual("GENERIC");
    });
});
