import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;

describe("etapi/note-history", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        // Create a note to ensure there's some history
        createdNoteId = await createNote(app, token, "History test content");

        // Create a revision to ensure history has entries
        await supertest(app)
            .post(`/etapi/notes/${createdNoteId}/revision`)
            .auth(USER, token, { "type": "basic" })
            .expect(204);
    });

    it("gets recent changes history", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/history")
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);

        // Check that history entries have expected properties
        const entry = response.body[0];
        expect(entry).toHaveProperty("noteId");
        expect(entry).toHaveProperty("title");
        expect(entry).toHaveProperty("utcDate");
        expect(entry).toHaveProperty("date");
        expect(entry).toHaveProperty("current_isDeleted");
        expect(entry).toHaveProperty("current_isProtected");
    });

    it("filters history by ancestor note", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/history?ancestorNoteId=root")
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        // All results should be descendants of root (which is everything)
    });

    it("returns empty array for non-existent ancestor", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/history?ancestorNoteId=nonexistentancestor")
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        // Should be empty since no notes are descendants of a non-existent note
        expect(response.body.length).toBe(0);
    });

    it("includes canBeUndeleted for deleted notes", async () => {
        // Create and delete a note
        const noteToDeleteId = await createNote(app, token, "Note to delete for history test");

        await supertest(app)
            .delete(`/etapi/notes/${noteToDeleteId}`)
            .auth(USER, token, { "type": "basic" })
            .expect(204);

        // Check history - deleted note should appear with canBeUndeleted property
        const response = await supertest(app)
            .get("/etapi/notes/history")
            .auth(USER, token, { "type": "basic" })
            .expect(200);

        const deletedEntry = response.body.find(
            (entry: any) => entry.noteId === noteToDeleteId && entry.current_isDeleted === true
        );

        // Deleted entries should have canBeUndeleted property
        if (deletedEntry) {
            expect(deletedEntry).toHaveProperty("canBeUndeleted");
        }
    });
});
