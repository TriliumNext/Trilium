import { becca, cls, events, password_encryption, protected_session, revisions } from "@triliumnext/core";
import { Application } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../src/services/config.js";
import { createNote, login } from "./utils.js";

let app: Application;
let token: string;

const USER = "etapi";
const PLAINTEXT_TITLE = "Bank account recovery codes";
const ATTACHMENT_TITLE = "passport-scan.png";
const REVISION_DESCRIPTION = "before rotating the seed phrase";

describe("etapi protected metadata", () => {
    let noteId: string;
    let attachmentId: string;
    let revisionId: string;

    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
        token = await login(app);
        noteId = await createNote(app, token);

        const attachmentResponse = await supertest(app)
            .post("/etapi/attachments")
            .auth(USER, token, { type: "basic" })
            .send({
                ownerId: noteId,
                role: "file",
                mime: "image/png",
                title: ATTACHMENT_TITLE,
                position: 10,
                content: "not a real png"
            })
            .expect(201);
        attachmentId = attachmentResponse.body.attachmentId;
        expect(attachmentId).toBeTruthy();

        await supertest(app)
            .post(`/etapi/notes/${noteId}/revision`)
            .auth(USER, token, { type: "basic" })
            .send({ description: REVISION_DESCRIPTION })
            .expect(204);

        const dataKey = await password_encryption.getDataKey("demo1234");
        if (!(dataKey instanceof Uint8Array)) {
            throw new Error("Expected a data key from the fixture password.");
        }

        protectFixture(dataKey, () => {
            const note = becca.getNoteOrThrow(noteId);
            note.title = PLAINTEXT_TITLE;
            note.isProtected = true;
            note.save();

            // `protectNote()` flips the owner note and its attachments together, so a
            // protected note never has unprotected attachments in practice.
            for (const attachment of note.getAttachments()) {
                attachment.isProtected = true;
                attachment.save();
            }

            revisions.protectRevisions(note);

            const [revision] = note.getRevisions();
            if (!revision?.revisionId) {
                throw new Error("Expected the fixture note to have a revision.");
            }
            revisionId = revision.revisionId;
            expect(revision.isProtected).toBe(true);
        });
    });

    afterAll(() => {
        protected_session.resetDataKey();
    });

    it("does not disclose the protected note title while the protected session is locked", async () => {
        expect(protected_session.default.isProtectedSessionAvailable()).toBe(false);

        const response = await supertest(app)
            .get(`/etapi/notes/${noteId}`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        expect(response.body.isProtected).toBe(true);
        expect(response.body.title).toStrictEqual("[protected]");
        expect(response.body.title).not.toContain(PLAINTEXT_TITLE);
    });

    it("does not disclose protected attachment titles when listing a note's attachments", async () => {
        expect(protected_session.default.isProtectedSessionAvailable()).toBe(false);

        const response = await supertest(app)
            .get(`/etapi/notes/${noteId}/attachments`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        const attachment = response.body.find((a: { attachmentId: string }) => a.attachmentId === attachmentId);
        expect(attachment).toBeTruthy();
        expect(attachment.title).toStrictEqual("[protected]");
        expect(attachment.title).not.toContain(ATTACHMENT_TITLE);
    });

    it("does not disclose a protected attachment title when read by id", async () => {
        expect(protected_session.default.isProtectedSessionAvailable()).toBe(false);

        const response = await supertest(app)
            .get(`/etapi/attachments/${attachmentId}`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        expect(response.body.title).toStrictEqual("[protected]");
        expect(response.body.title).not.toContain(ATTACHMENT_TITLE);
    });

    it("refuses a protected revision read by id", async () => {
        const response = await supertest(app)
            .get(`/etapi/revisions/${revisionId}`)
            .auth(USER, token, { type: "basic" })
            .expect(400);

        expect(response.body.code).toStrictEqual("REVISION_IS_PROTECTED");
    });

    it("does not list protected revisions, which the by-id read refuses", async () => {
        expect(protected_session.default.isProtectedSessionAvailable()).toBe(false);

        const response = await supertest(app)
            .get(`/etapi/notes/${noteId}/revisions`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.find((r: { revisionId: string }) => r.revisionId === revisionId)).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toContain(REVISION_DESCRIPTION);
    });
});

/**
 * Runs `fn` with the protected session unlocked, then locks it again the way
 * `logoutFromProtectedSession()` does. The LEAVE event reloads becca, which is what
 * drops the decrypted note title from memory.
 */
function protectFixture(dataKey: Uint8Array, fn: () => void) {
    cls.init(() => {
        protected_session.default.setDataKey(dataKey);
        try {
            fn();
        } finally {
            protected_session.resetDataKey();
            events.emit(events.LEAVE_PROTECTED_SESSION);
        }
    });
}
