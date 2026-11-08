import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import buildApp from "../../src/app.js";
import supertest from "supertest";

let app: Application;
let token: string;

describe("etapi/app-info", () => {
    beforeAll(async () => {
        app = await buildApp();
    });

    it("retrieves correct app info", async () => {
        const response = await supertest(app)
            .get("/etapi/app-info")
            .expect(200);
        expect(response.body.clipperProtocolVersion).toBe("1.1");
    });
});
