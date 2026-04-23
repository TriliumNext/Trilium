import { Application } from "express";
import { beforeAll, describe, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;

describe("etapi/post-revision", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
        createdNoteId = await createNote(app, token);
    });

    it("posts note revision", async () => {
        await supertest(app)
            .post(`/etapi/notes/${createdNoteId}/revision`)
            .auth(USER, token, { "type": "basic"})
            .send("Changed content")
            .expect(204);
    });
});
