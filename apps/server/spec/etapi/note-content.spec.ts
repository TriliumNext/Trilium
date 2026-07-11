import { becca } from "@triliumnext/core";
import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;

describe("etapi/note-content", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        createdNoteId = await createNote(app, token);
    });

    it("get content", async () => {
        const response = await getContentResponse();
        expect(response.text).toStrictEqual("Hi there!");
    });

    it("put note content", async () => {
        const text = "Changed content";
        await supertest(app)
            .put(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "text/plain")
            .send(text)
            .expect(204);

        const response = await getContentResponse();
        expect(response.text).toStrictEqual(text);
    });

    it("put note content binary", async () => {
        // First, create a binary note
        const response = await supertest(app)
            .post("/etapi/create-note")
            .auth("etapi", token, { "type": "basic"})
            .send({
                "parentNoteId": "root",
                "title": "Hello",
                "mime": "image/png",
                "type": "image",
                "content": ""
            })
            .expect(201);
        const createdNoteId = response.body.note.noteId;

        // Put binary content
        await supertest(app)
            .put(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "application/octet-stream")
            .set("Content-Transfer-Encoding", "binary")
            .send(Buffer.from("Hello world"))
            .expect(204);
    });

    it("refuses to read and write a protected note's content", async () => {
        const noteId = await createNote(app, token);
        const note = becca.getNoteOrThrow(noteId);
        note.isProtected = true;
        try {
            const get = await supertest(app)
                .get(`/etapi/notes/${noteId}/content`)
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(get.body.code).toStrictEqual("NOTE_IS_PROTECTED");

            const put = await supertest(app)
                .put(`/etapi/notes/${noteId}/content`)
                .auth(USER, token, { "type": "basic"})
                .set("Content-Type", "text/plain")
                .send("data")
                .expect(400);
            expect(put.body.code).toStrictEqual("NOTE_IS_PROTECTED");
        } finally {
            note.isProtected = false;
        }
    });

    function getContentResponse() {
        return supertest(app)
            .get(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
    }
});
