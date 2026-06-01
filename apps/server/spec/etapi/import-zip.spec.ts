import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import { readFileSync } from "fs";
import { join } from "path";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/import", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("demo zip can be imported", async () => {
        const buffer = readFileSync(join(__dirname, "../../src/assets/db/demo.zip"));
        const response = await supertest(app)
            .post("/etapi/notes/root/import")
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "application/octet-stream")
            .set("Content-Transfer-Encoding", "binary")
            .send(buffer)
            .expect(201);
        expect(response.body.note.title).toStrictEqual("Journal");
        expect(response.body.branch.parentNoteId).toStrictEqual("root");
    });
});
