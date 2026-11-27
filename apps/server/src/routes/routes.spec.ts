import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Application;

describe("route registration outside the in-memory integration test", () => {
    beforeAll(async () => {
        const integrationTest = process.env.TRILIUM_INTEGRATION_TEST;
        process.env.TRILIUM_INTEGRATION_TEST = "edit";
        try {
            app = await (await import("../app.js")).default();
        } finally {
            process.env.TRILIUM_INTEGRATION_TEST = integrationTest;
        }
    });

    it("answers the health check without authentication", async () => {
        const response = await supertest(app).get("/api/health-check").expect(200);

        expect(response.body).toEqual({ status: "ok" });
    });

    it("leaves out the database rebuild route", async () => {
        const response = await supertest(app).post("/api/database/rebuild/").expect(404);

        expect(response.body.message).toBe("Router not found for request POST /api/database/rebuild/");
    });
});
