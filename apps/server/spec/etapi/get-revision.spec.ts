import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;
let revisionId: string;

describe("etapi/get-revision", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
        createdNoteId = await createNote(app, token, "Initial content");

        // Update content to create a revision
        await supertest(app)
            .put(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic" })
            .set("Content-Type", "text/plain")
            .send("Updated content")
            .expect(204);

        // Force create a revision
        await supertest(app)
            .post(`/etapi/notes/${createdNoteId}/revision`)
            .auth(USER, token, { "type": "basic" })
            .expect(204);

        // Get the revision ID
        const revisionsResponse = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}/revisions`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(revisionsResponse.body.length).toBeGreaterThan(0);
        revisionId = revisionsResponse.body[0].revisionId;
    });

    it("gets revision metadata by ID", async () => {
        const response = await supertest(app)
            .get(`/etapi/revisions/${revisionId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(response.body).toHaveProperty("revisionId", revisionId);
        expect(response.body).toHaveProperty("noteId", createdNoteId);
        expect(response.body).toHaveProperty("type", "text");
        expect(response.body).toHaveProperty("mime", "text/html");
        expect(response.body).toHaveProperty("title", "Hello");
        expect(response.body).toHaveProperty("isProtected", false);
        expect(response.body).toHaveProperty("blobId");
        expect(response.body).toHaveProperty("utcDateCreated");
        expect(response.body).toHaveProperty("utcDateModified");
    });

    it("returns 404 for non-existent revision", async () => {
        const response = await supertest(app)
            .get("/etapi/revisions/nonexistentrevision")
            .auth(USER, token, { "type": "basic" })
            .expect(404);

        expect(response.body.code).toStrictEqual("REVISION_NOT_FOUND");
    });
});
