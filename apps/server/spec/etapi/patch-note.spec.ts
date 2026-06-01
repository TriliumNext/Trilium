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

describe("etapi/patch-note", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        const response = await supertest(app)
            .post("/etapi/create-note")
            .auth("etapi", token, { "type": "basic"})
            .send({
                "parentNoteId": "root",
                "title": "Hello",
                "type": "code",
                "mime": "application/json",
                "content": "{}"
            })
            .expect(201);

        createdNoteId = response.body.note.noteId as string;
        expect(createdNoteId).toBeTruthy();
    });

    it("obtains correct note information", async () => {
        await expectNoteToMatch({
            title: "Hello",
            type: "code",
            mime: "application/json"
        });
    });

    it("patches type, mime and creation dates", async () => {
        const changes = {
            "title": "Wassup",
            "type": "html",
            "mime": "text/html",
            "dateCreated": "2023-08-21 23:38:51.123+0200",
            "utcDateCreated": "2023-08-21 23:38:51.123Z"
        };
        await supertest(app)
            .patch(`/etapi/notes/${createdNoteId}`)
            .auth("etapi", token, { "type": "basic"})
            .send(changes)
            .expect(200);
        await expectNoteToMatch(changes);
    });

    it("refuses setting protection", async () => {
        const response = await supertest(app)
            .patch(`/etapi/notes/${createdNoteId}`)
            .auth("etapi", token, { "type": "basic"})
            .send({
                isProtected: true
            })
            .expect(400);
        expect(response.body.code).toStrictEqual("PROPERTY_NOT_ALLOWED");
    });

    it("refuses incorrect type", async () => {
        const response = await supertest(app)
            .patch(`/etapi/notes/${createdNoteId}`)
            .auth("etapi", token, { "type": "basic"})
            .send({
                title: true
            })
            .expect(400);
        expect(response.body.code).toStrictEqual("PROPERTY_VALIDATION_ERROR");
    });

    it("rejects turning a note into an image with a non-image MIME", async () => {
        const response = await supertest(app)
            .patch(`/etapi/notes/${createdNoteId}`)
            .auth("etapi", token, { "type": "basic"})
            .send({ type: "image", mime: "text/plain" })
            .expect(400);
        expect(response.body.code).toStrictEqual("INVALID_MIME_FOR_IMAGE");
    });

    it("refuses to patch a protected note", async () => {
        const noteId = await createNote(app, token);
        const note = becca.getNoteOrThrow(noteId);
        note.isProtected = true;
        try {
            const response = await supertest(app)
                .patch(`/etapi/notes/${noteId}`)
                .auth("etapi", token, { "type": "basic"})
                .send({ title: "x" })
                .expect(400);
            expect(response.body.code).toStrictEqual("NOTE_IS_PROTECTED");
        } finally {
            note.isProtected = false;
        }
    });

    async function expectNoteToMatch(state: object) {
        const response = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}`)
            .auth("etapi", token, { "type": "basic"})
            .expect(200);
        expect(response.body).toMatchObject(state);
    }
});
