import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import config from "../../src/services/config.js";

let app: Application;

describe("etapi/etapi.openapi.yaml", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    it("serves the OpenAPI specification (and the cached copy on repeat)", async () => {
        const response = await supertest(app).get("/etapi/etapi.openapi.yaml").expect(200);
        expect(response.headers["content-type"]).toContain("text/plain");
        expect(response.text).toContain("openapi");

        // Second request is served from the in-memory cache.
        const cached = await supertest(app).get("/etapi/etapi.openapi.yaml").expect(200);
        expect(cached.text).toStrictEqual(response.text);
    });
});
