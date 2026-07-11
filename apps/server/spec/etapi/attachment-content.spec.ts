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

    it("changes attachment content", async () => {
        const text = "Changed content";
        await supertest(app)
            .put(`/etapi/attachments/${createdAttachmentId}/content`)
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "text/plain")
            .send(text)
            .expect(204);

        // Ensure it got changed.
        const response = await supertest(app)
            .get(`/etapi/attachments/${createdAttachmentId}/content`)
            .auth(USER, token, { "type": "basic"});
        expect(response.text).toStrictEqual(text);
    });

    it("supports binary content", async() => {
        await supertest(app)
            .put(`/etapi/attachments/${createdAttachmentId}/content`)
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "application/octet-stream")
            .set("Content-Transfer-Encoding", "binary")
            .send(Buffer.from("Hello world"))
            .expect(204);
    });

    it("refuses to read and write a protected attachment's content", async () => {
        cls.init(() => sql.execute("UPDATE attachments SET isProtected = 1 WHERE attachmentId = ?", [createdAttachmentId]));
        try {
            const get = await supertest(app)
                .get(`/etapi/attachments/${createdAttachmentId}/content`)
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(get.body.code).toStrictEqual("ATTACHMENT_IS_PROTECTED");

            const put = await supertest(app)
                .put(`/etapi/attachments/${createdAttachmentId}/content`)
                .auth(USER, token, { "type": "basic"})
                .set("Content-Type", "text/plain")
                .send("data")
                .expect(400);
            expect(put.body.code).toStrictEqual("ATTACHMENT_IS_PROTECTED");
        } finally {
            cls.init(() => sql.execute("UPDATE attachments SET isProtected = 0 WHERE attachmentId = ?", [createdAttachmentId]));
        }
    });

});
