import { cls } from "@triliumnext/core";
import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";
import sql from "../../src/services/sql.js";

let app: Application;
let token: string;

const USER = "etapi";
let createdNoteId: string;
let createdAttachmentId: string;

describe("etapi/attachment-content", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        createdNoteId = await createNote(app, token);

        // Create an attachment
        const response = await supertest(app)
            .post(`/etapi/attachments`)
            .auth(USER, token, { "type": "basic"})
            .send({
                "ownerId": createdNoteId,
                "role": "file",
                "mime": "text/plain",
                "title": "my attachment",
                "content": "text"
            });
        createdAttachmentId = response.body.attachmentId;
        expect(createdAttachmentId).toBeTruthy();
    });

    it("changes title and position", async () => {
        const state = {
            title: "CHANGED",
            position: 999
        }
        await supertest(app)
            .patch(`/etapi/attachments/${createdAttachmentId}`)
            .auth(USER, token, { "type": "basic"})
            .send(state)
            .expect(200);

        // Ensure it got changed.
        const response = await supertest(app)
            .get(`/etapi/attachments/${createdAttachmentId}`)
            .auth(USER, token, { "type": "basic"});
        expect(response.body).toMatchObject(state);
    });

    it("forbids changing owner", async () => {
        const response = await supertest(app)
            .patch(`/etapi/attachments/${createdAttachmentId}`)
            .auth(USER, token, { "type": "basic"})
            .send({
                ownerId: "root"
            })
            .expect(400);
        expect(response.body.code).toStrictEqual("PROPERTY_NOT_ALLOWED");
    });

    it("handles validation error", async () => {
        const response = await supertest(app)
            .patch(`/etapi/attachments/${createdAttachmentId}`)
            .auth(USER, token, { "type": "basic"})
            .send({
                title: null
            })
            .expect(400);
        expect(response.body.code).toStrictEqual("PROPERTY_VALIDATION_ERROR");
    });

    it("reports a 500 when creating an attachment without an owner", async () => {
        const response = await supertest(app)
            .post("/etapi/attachments")
            .auth(USER, token, { "type": "basic"})
            .send({ role: "file", mime: "text/plain", title: "orphan" })
            .expect(500);
        expect(response.body.code).toStrictEqual("GENERIC");
    });

    it("refuses to patch a protected attachment", async () => {
        cls.init(() => sql.execute("UPDATE attachments SET isProtected = 1 WHERE attachmentId = ?", [createdAttachmentId]));
        try {
            const response = await supertest(app)
                .patch(`/etapi/attachments/${createdAttachmentId}`)
                .auth(USER, token, { "type": "basic"})
                .send({ title: "x" })
                .expect(400);
            expect(response.body.code).toStrictEqual("ATTACHMENT_IS_PROTECTED");
        } finally {
            cls.init(() => sql.execute("UPDATE attachments SET isProtected = 0 WHERE attachmentId = ?", [createdAttachmentId]));
        }
    });

});
