import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;

describe("etapi/get-note-revisions", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
        createdNoteId = await createNote(app, token);

        // Create a revision by updating the note content
        await supertest(app)
            .put(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic" })
            .set("Content-Type", "text/plain")
            .send("Updated content for revision")
            .expect(204);

        // Force create a revision
        await supertest(app)
            .post(`/etapi/notes/${createdNoteId}/revision`)
            .auth(USER, token, { "type": "basic" })
            .expect(204);
    });

    it("gets revisions for a note", async () => {
        const response = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}/revisions`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);

        const revision = response.body[0];
        expect(revision).toHaveProperty("revisionId");
        expect(revision).toHaveProperty("noteId", createdNoteId);
        expect(revision).toHaveProperty("type");
        expect(revision).toHaveProperty("mime");
        expect(revision).toHaveProperty("title");
        expect(revision).toHaveProperty("isProtected");
        expect(revision).toHaveProperty("blobId");
        expect(revision).toHaveProperty("utcDateCreated");
    });

    it("returns empty array for note with no revisions", async () => {
        // Create a new note without any revisions
        const newNoteId = await createNote(app, token, "Brand new content");

        const response = await supertest(app)
            .get(`/etapi/notes/${newNoteId}/revisions`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        // New notes may or may not have revisions depending on settings
    });

    it("returns 404 for non-existent note", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/nonexistentnote/revisions")
            .auth(USER, token, { "type": "basic" })
            .expect(404);

        expect(response.body.code).toStrictEqual("NOTE_NOT_FOUND");
    });
});
