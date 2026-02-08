import { Application } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import { randomInt } from "crypto";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/undelete-note", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("undeletes a deleted note", async () => {
        // Create a note
        const noteId = `testNote${randomInt(10000)}`;
        await supertest(app)
            .post("/etapi/create-note")
            .auth(USER, token, { "type": "basic" })
            .send({
                "noteId": noteId,
                "parentNoteId": "root",
                "title": "Note to delete and restore",
                "type": "text",
                "content": "Content to restore"
            })
            .expect(201);

        // Verify note exists
        await supertest(app)
            .get(`/etapi/notes/${noteId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        // Delete the note
        await supertest(app)
            .delete(`/etapi/notes/${noteId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(204);

        // Verify note is deleted (should return 404)
        await supertest(app)
            .get(`/etapi/notes/${noteId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(404);

        // Undelete the note
        const response = await supertest(app)
            .post(`/etapi/notes/${noteId}/undelete`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(response.body).toHaveProperty("success", true);

        // Verify note is restored
        const restoredResponse = await supertest(app)
            .get(`/etapi/notes/${noteId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(restoredResponse.body.title).toStrictEqual("Note to delete and restore");
    });

    it("returns 404 for non-existent note", async () => {
        const response = await supertest(app)
            .post("/etapi/notes/nonexistentnote/undelete")
            .auth(USER, token, { "type": "basic" })
            .expect(404);

        expect(response.body.code).toStrictEqual("NOTE_NOT_FOUND");
    });

    it("returns 400 when trying to undelete a non-deleted note", async () => {
        // Create a note
        const noteId = `testNote${randomInt(10000)}`;
        await supertest(app)
            .post("/etapi/create-note")
            .auth(USER, token, { "type": "basic" })
            .send({
                "noteId": noteId,
                "parentNoteId": "root",
                "title": "Note not deleted",
                "type": "text",
                "content": "Content"
            })
            .expect(201);

        // Try to undelete a note that isn't deleted
        const response = await supertest(app)
            .post(`/etapi/notes/${noteId}/undelete`)
            .auth(USER, token, { "type": "basic" })
            .expect(400);

        expect(response.body.code).toStrictEqual("NOTE_NOT_DELETED");
    });
});
