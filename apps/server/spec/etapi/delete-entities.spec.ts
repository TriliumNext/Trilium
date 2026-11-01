import { Application } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import { newEntityId } from "../../src/services/utils.js";

let app: Application;
let token: string;
let createdNoteId: string;
let createdBranchId: string;

const USER = "etapi";

type EntityType = "attachments" | "attributes" | "branches" | "notes";

describe("etapi/delete-entities", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    beforeEach(async () => {
        ({ createdNoteId, createdBranchId } = await createNote());
    });

    it("deletes attachment", async () => {
        const attachmentId = await createAttachment();
        await deleteEntity("attachments", attachmentId);
        await expectNotFound("attachments", attachmentId);
    });

    it("deletes attribute", async () => {
        const attributeId = await createAttribute();
        await deleteEntity("attributes", attributeId);
        await expectNotFound("attributes", attributeId);
    });

    it("deletes cloned branch", async () => {
        const clonedBranchId = await createClone();

        await expectFound("branches", createdBranchId);
        await expectFound("branches", clonedBranchId);

        await deleteEntity("branches", createdBranchId);
        await expectNotFound("branches", createdBranchId);

        await expectFound("branches", clonedBranchId);
        await expectFound("notes", createdNoteId);
    });

    it("deletes note with all branches", async () => {
        const attributeId = await createAttribute();

        const clonedBranchId = await createClone();

        await expectFound("notes", createdNoteId);
        await expectFound("branches", createdBranchId);
        await expectFound("branches", clonedBranchId);
        await expectFound("attributes", attributeId);
        await deleteEntity("notes", createdNoteId);

        await expectNotFound("branches", createdBranchId);
        await expectNotFound("branches", clonedBranchId);
        await expectNotFound("notes", createdNoteId);
        await expectNotFound("attributes", attributeId);
    });
});

async function createNote() {
    const noteId = `forcedId${newEntityId()}`;
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
    const attributeId = `forcedId${newEntityId()}`;
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

async function deleteEntity(entity: EntityType, id: string) {
    // Delete twice to test idempotency.
    for (let i=0; i < 2; i++) {
        await supertest(app)
            .delete(`/etapi/${entity}/${id}`)
            .auth(USER, token, { "type": "basic"})
            .expect(204);
    }
}

const MISSING_ENTITY_ERROR_CODES: Record<EntityType, string> = {
    attachments: "ATTACHMENT_NOT_FOUND",
    attributes: "ATTRIBUTE_NOT_FOUND",
    branches: "BRANCH_NOT_FOUND",
    notes: "NOTE_NOT_FOUND"
}

async function expectNotFound(entity: EntityType, id: string) {
    const response = await supertest(app)
            .get(`/etapi/${entity}/${id}`)
            .auth(USER, token, { "type": "basic"})
            .expect(404);

    expect(response.body.code).toStrictEqual(MISSING_ENTITY_ERROR_CODES[entity]);
}

async function expectFound(entity: EntityType, id: string) {
    await supertest(app)
            .get(`/etapi/${entity}/${id}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
}
