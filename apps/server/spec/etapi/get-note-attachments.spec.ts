import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;
let createdAttachmentId: string;

describe("etapi/get-note-attachments", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        createdNoteId = await createNote(app, token);

        // Create an attachment for the note
        const response = await supertest(app)
            .post(`/etapi/attachments`)
            .auth(USER, token, { "type": "basic" })
            .send({
                "ownerId": createdNoteId,
                "role": "file",
                "mime": "text/plain",
                "title": "test-attachment.txt",
                "content": "test content",
                "position": 10
            });
        createdAttachmentId = response.body.attachmentId;
        expect(createdAttachmentId).toBeTruthy();
    });

    it("gets attachments for a note", async () => {
        const response = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}/attachments`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);

        const attachment = response.body[0];
        expect(attachment).toHaveProperty("attachmentId", createdAttachmentId);
        expect(attachment).toHaveProperty("ownerId", createdNoteId);
        expect(attachment).toHaveProperty("role", "file");
        expect(attachment).toHaveProperty("mime", "text/plain");
        expect(attachment).toHaveProperty("title", "test-attachment.txt");
        expect(attachment).toHaveProperty("position", 10);
        expect(attachment).toHaveProperty("blobId");
        expect(attachment).toHaveProperty("dateModified");
        expect(attachment).toHaveProperty("utcDateModified");
        expect(attachment).toHaveProperty("contentLength");
    });

    it("returns empty array for note with no attachments", async () => {
        // Create a new note without any attachments
        const newNoteId = await createNote(app, token, "Note without attachments");

        const response = await supertest(app)
            .get(`/etapi/notes/${newNoteId}/attachments`)
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(0);
    });

    it("returns 404 for non-existent note", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/nonexistentnote/attachments")
            .auth(USER, token, { "type": "basic" })
            .expect(404);

        expect(response.body.code).toStrictEqual("NOTE_NOT_FOUND");
    });
});
