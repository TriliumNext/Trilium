import { BBranch, note_service as noteService } from "@triliumnext/core";
import { Application } from "express";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import { randomInt } from "crypto";

let app: Application;
let token: string;
let createdNoteId: string;
let createdBranchId: string;
let clonedBranchId: string;
let createdAttributeId: string;
let createdAttachmentId: string;

const USER = "etapi";

describe("etapi/create-entities", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        ({ createdNoteId, createdBranchId } = await createNote());
        clonedBranchId = await createClone();
        createdAttributeId = await createAttribute();
        createdAttachmentId = await createAttachment();
    });

    it("returns note info", async () => {
        const response = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}`)
            .auth(USER, token, { "type": "basic"})
            .send({
                noteId: createdNoteId,
                parentNoteId: "_hidden"
            })
            .expect(200);
        expect(response.body).toMatchObject({
            noteId: createdNoteId,
            title: "Hello"
        });
        expect(new Set<string>(response.body.parentBranchIds))
            .toStrictEqual(new Set<string>([ clonedBranchId, createdBranchId ]));
    });

    it("obtains note content", async () => {
        await supertest(app)
            .get(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic"})
            .expect(200)
            .expect("Hi there!");
    });

    it("obtains created branch information", async () => {
        const response = await supertest(app)
            .get(`/etapi/branches/${createdBranchId}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body).toMatchObject({
            branchId: createdBranchId,
            parentNoteId: "root"
        });
    });

    it("obtains cloned branch information", async () => {
        const response = await supertest(app)
            .get(`/etapi/branches/${clonedBranchId}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body).toMatchObject({
            branchId: clonedBranchId,
            parentNoteId: "_hidden"
        });
    });

    it("obtains attribute information", async () => {
        const response = await supertest(app)
            .get(`/etapi/attributes/${createdAttributeId}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body.attributeId).toStrictEqual(createdAttributeId);
    });

    it("obtains attachment information", async () => {
        const response = await supertest(app)
            .get(`/etapi/attachments/${createdAttachmentId}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body.attachmentId).toStrictEqual(createdAttachmentId);
        expect(response.body).toMatchObject({
            role: "file",
            mime: "plain/text",
            title: "my attachment"
        });
    });

    describe("error and edge cases", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("rejects creating an image note with a non-image MIME", async () => {
            const response = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({ parentNoteId: "root", title: "img", type: "image", mime: "text/plain" })
                .expect(400);
            expect(response.body.code).toStrictEqual("INVALID_MIME_FOR_IMAGE");
        });

        it("reports a 500 when note creation throws", async () => {
            vi.spyOn(noteService, "createNewNote").mockImplementation(() => {
                throw new Error("boom");
            });
            const response = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({ parentNoteId: "root", title: "x", type: "text", content: "x" })
                .expect(500);
            expect(response.body.code).toStrictEqual("GENERIC");
        });

        it("creates a relation attribute, validating the target note", async () => {
            const response = await supertest(app)
                .post("/etapi/attributes")
                .auth(USER, token, { "type": "basic"})
                .send({ noteId: createdNoteId, type: "relation", name: "myrelation", value: "root" })
                .expect(201);
            expect(response.body.type).toStrictEqual("relation");
        });

        it("reports a 400 when branch creation throws", async () => {
            // A fresh note with no existing branch under _hidden, so the route takes the
            // "new BBranch().save()" path (the try/catch) rather than updating an existing one.
            const noteResp = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({ parentNoteId: "root", title: "branch-fail", type: "text", content: "x" })
                .expect(201);
            const noteId = noteResp.body.note.noteId;

            vi.spyOn(BBranch.prototype, "save").mockImplementation(() => {
                throw new Error("boom");
            });
            const response = await supertest(app)
                .post("/etapi/branches")
                .auth(USER, token, { "type": "basic"})
                .send({ noteId, parentNoteId: "_hidden" })
                .expect(400);
            expect(response.body.code).toStrictEqual("GENERIC");
        });
    });
});

async function createNote() {
    const noteId = `forcedId${randomInt(1000)}`;
    const response = await supertest(app)
        .post("/etapi/create-note")
        .auth(USER, token, { "type": "basic"})
        .send({
            "noteId": noteId,
            "parentNoteId": "root",
            "title": "Hello",
            "type": "text",
            "content": "Hi there!",
            "dateCreated": "2023-08-21 23:38:51.123+0200",
            "utcDateCreated": "2023-08-21 23:38:51.123Z"
        })
        .expect(201);
    expect(response.body.note.noteId).toStrictEqual(noteId);
    expect(response.body).toMatchObject({
        note: {
            noteId,
            title: "Hello",
            dateCreated: "2023-08-21 23:38:51.123+0200",
            utcDateCreated: "2023-08-21 23:38:51.123Z"
        },
        branch: {
            parentNoteId: "root"
        }
    });

    return {
        createdNoteId: response.body.note.noteId,
        createdBranchId: response.body.branch.branchId
    };
}

async function createClone() {
    const response = await supertest(app)
        .post("/etapi/branches")
        .auth(USER, token, { "type": "basic"})
        .send({
            noteId: createdNoteId,
            parentNoteId: "_hidden"
        })
        .expect(201);
    expect(response.body.parentNoteId).toStrictEqual("_hidden");
    return response.body.branchId;
}

async function createAttribute() {
    const attributeId = `forcedId${randomInt(1000)}`;
    const response = await supertest(app)
        .post("/etapi/attributes")
        .auth(USER, token, { "type": "basic"})
        .send({
            "attributeId": attributeId,
            "noteId": createdNoteId,
            "type": "label",
            "name": "mylabel",
            "value": "val",
            "isInheritable": true
        })
        .expect(201);
    expect(response.body.attributeId).toStrictEqual(attributeId);
    return response.body.attributeId;
}

async function createAttachment() {
    const response = await supertest(app)
        .post("/etapi/attachments")
        .auth(USER, token, { "type": "basic"})
        .send({
            "ownerId": createdNoteId,
            "role": "file",
            "mime": "plain/text",
            "title": "my attachment",
            "content": "my text"
        })
        .expect(201);
    return response.body.attachmentId;
}
