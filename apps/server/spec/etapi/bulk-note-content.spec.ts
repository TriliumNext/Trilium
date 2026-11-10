import { becca, note_service as noteService } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import config from "../../src/services/config.js";
import { createNote, login } from "./utils.js";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/notes/bulk-update", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
        token = await login(app);
    });

    it("bulk updates multiple notes content", async () => {
        const noteId1 = await createNote(app, token);
        const noteId2 = await createNote(app, token);

        const newContent1 = "<p>Updated content 1</p>";
        const newContent2 = "<p>Updated content 2</p>";

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [
                    { noteId: noteId1, content: newContent1 },
                    { noteId: noteId2, content: newContent2 }
                ]
            })
            .expect(200);

        expect(response.body).toStrictEqual({
            total: 2,
            updated: 2,
            failed: 0,
            errors: []
        });

        const get1 = await supertest(app)
            .get(`/etapi/notes/${noteId1}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get1.text).toStrictEqual(newContent1);

        const get2 = await supertest(app)
            .get(`/etapi/notes/${noteId2}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get2.text).toStrictEqual(newContent2);
    });

    it("bulk updates with skipFts=true", async () => {
        const noteId = await createNote(app, token);
        const content = "<p>Fast bulk update without FTS</p>";

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update?skipFts=true")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [ { noteId, content } ]
            })
            .expect(200);

        expect(response.body.updated).toStrictEqual(1);

        const get = await supertest(app)
            .get(`/etapi/notes/${noteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get.text).toStrictEqual(content);
    });

    it("handles partial failure when atomic=false (default)", async () => {
        const noteId = await createNote(app, token);
        const validContent = "<p>Valid note updated</p>";

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [
                    { noteId, content: validContent },
                    { noteId: "nonExistentNoteId", content: "some content" }
                ]
            })
            .expect(200);

        expect(response.body.total).toStrictEqual(2);
        expect(response.body.updated).toStrictEqual(1);
        expect(response.body.failed).toStrictEqual(1);
        expect(response.body.errors).toHaveLength(1);
        expect(response.body.errors[0].noteId).toStrictEqual("nonExistentNoteId");

        const get = await supertest(app)
            .get(`/etapi/notes/${noteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get.text).toStrictEqual(validContent);
    });

    it("rolls back all updates when atomic=true and one item fails", async () => {
        const noteId = await createNote(app, token);
        const initialContent = (await supertest(app)
            .get(`/etapi/notes/${noteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200)).text;

        await supertest(app)
            .post("/etapi/notes/bulk-update?atomic=true")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [
                    { noteId, content: "<p>Should be rolled back</p>" },
                    { noteId: "missingNoteId123", content: "invalid" }
                ]
            })
            .expect(404);

        // Verify initial content was preserved by rollback
        const get = await supertest(app)
            .get(`/etapi/notes/${noteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get.text).toStrictEqual(initialContent);
    });

    it("rolls back all updates and restores in-memory cache when atomic=true and a runtime error occurs", async () => {
        const noteId1 = await createNote(app, token);
        const noteId2 = await createNote(app, token);

        const initialContent1 = (await supertest(app)
            .get(`/etapi/notes/${noteId1}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200)).text;

        const initialContent2 = (await supertest(app)
            .get(`/etapi/notes/${noteId2}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200)).text;

        let callCount = 0;
        const spy = vi.spyOn(noteService, "saveRevisionIfNeeded").mockImplementation((note) => {
            callCount++;
            if (callCount === 2) {
                throw new Error("Simulated runtime failure on second item");
            }
        });

        try {
            await supertest(app)
                .post("/etapi/notes/bulk-update?atomic=true")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId: noteId1, content: "<p>Mutated content 1 that must roll back</p>" },
                        { noteId: noteId2, content: "<p>Mutated content 2</p>" }
                    ]
                })
                .expect(500);

            // Verify in-memory Becca entity for note 1 was restored
            const beccaNote1 = becca.getNoteOrThrow(noteId1);
            expect(beccaNote1.getContent()).toStrictEqual(initialContent1);

            // Verify SQLite DB was rolled back
            const get1 = await supertest(app)
                .get(`/etapi/notes/${noteId1}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get1.text).toStrictEqual(initialContent1);

            const get2 = await supertest(app)
                .get(`/etapi/notes/${noteId2}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get2.text).toStrictEqual(initialContent2);
        } finally {
            spy.mockRestore();
        }
    });

    it("handles multiple updates to the same note within one batch", async () => {
        const noteId = await createNote(app, token);

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [
                    { noteId, content: "<p>Intermediate content</p>" },
                    { noteId, content: "<p>Final content</p>" }
                ]
            })
            .expect(200);

        expect(response.body.updated).toStrictEqual(2);

        const get = await supertest(app)
            .get(`/etapi/notes/${noteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get.text).toStrictEqual("<p>Final content</p>");
    });

    it("refuses to update protected notes", async () => {
        const noteId = await createNote(app, token);
        const note = becca.getNoteOrThrow(noteId);
        note.isProtected = true;

        try {
            const response = await supertest(app)
                .post("/etapi/notes/bulk-update")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [ { noteId, content: "protected attempt" } ]
                })
                .expect(200);

            expect(response.body.updated).toStrictEqual(0);
            expect(response.body.failed).toStrictEqual(1);
            expect(response.body.errors[0].error).toContain("protected");
        } finally {
            note.isProtected = false;
        }
    });

    it("validates request payload structure", async () => {
        // Missing items array
        await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({})
            .expect(400);

        // Empty items returns 0 updated
        const emptyResp = await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({ items: [] })
            .expect(200);
        expect(emptyResp.body.total).toStrictEqual(0);
    });
});
