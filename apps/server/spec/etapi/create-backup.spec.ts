import { getBackup } from "@triliumnext/core";
import { Application } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/backup", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("backup works", async () => {
        await supertest(app)
            .put("/etapi/backup/etapi_test")
            .auth(USER, token, { "type": "basic"})
            .expect(204);
    });

    it("reports a 500 when the backup fails", async () => {
        vi.spyOn(getBackup(), "backupNow").mockRejectedValue(new Error("boom"));
        try {
            await supertest(app)
                .put("/etapi/backup/etapi_fail")
                .auth(USER, token, { "type": "basic"})
                .expect(500);
        } finally {
            vi.restoreAllMocks();
        }
    });
});
