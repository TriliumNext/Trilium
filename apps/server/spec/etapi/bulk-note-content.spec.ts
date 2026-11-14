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

    it("safely handles non-image note types with skipFts=true", async () => {
        const createRes = await supertest(app)
            .post("/etapi/create-note")
            .auth(USER, token, { type: "basic" })
            .send({
                parentNoteId: "root",
                title: "Code Note",
                type: "code",
                mime: "application/javascript",
                content: "console.log('hello');"
            })
            .expect(201);

        const codeNoteId = createRes.body.note.noteId;
        const newCode = "console.log('updated');";

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update?skipFts=true")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [ { noteId: codeNoteId, content: newCode } ]
            })
            .expect(200);

        expect(response.body.updated).toStrictEqual(1);

        const get = await supertest(app)
            .get(`/etapi/notes/${codeNoteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);
        expect(get.text).toStrictEqual(newCode);
    });

    it("rewrites copied attachment references and saves rewritten content when skipFts=true", async () => {
        const sourceNoteId = await createNote(app, token);
        const targetNoteId = await createNote(app, token);

        const attRes = await supertest(app)
            .post("/etapi/attachments")
            .auth(USER, token, { type: "basic" })
            .send({
                ownerId: sourceNoteId,
                role: "image",
                mime: "image/png",
                title: "photo.png",
                content: "fake-png-content"
            })
            .expect(201);

        const foreignAttId = attRes.body.attachmentId;
        const originalContentWithForeignAtt = `<p><img src="api/attachments/${foreignAttId}/image/photo.png"></p>`;

        const response = await supertest(app)
            .post("/etapi/notes/bulk-update?skipFts=true")
            .auth(USER, token, { type: "basic" })
            .send({
                items: [ { noteId: targetNoteId, content: originalContentWithForeignAtt } ]
            })
            .expect(200);

        expect(response.body.updated).toStrictEqual(1);

        const targetGet = await supertest(app)
            .get(`/etapi/notes/${targetNoteId}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        // Foreign attachment ID must have been rewritten to the newly copied local attachment
        expect(targetGet.text).not.toContain(foreignAttId);
        expect(targetGet.text).toMatch(/api\/attachments\/[a-zA-Z0-9_]+\/image/);

        // Verify the copied attachment exists under targetNote
        const targetAttsRes = await supertest(app)
            .get(`/etapi/notes/${targetNoteId}/attachments`)
            .auth(USER, token, { type: "basic" })
            .expect(200);

        expect(targetAttsRes.body).toHaveLength(1);
        expect(targetGet.text).toContain(targetAttsRes.body[0].attachmentId);
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

        // Non-string noteId is rejected cleanly in both atomic and non-atomic modes
        await supertest(app)
            .post("/etapi/notes/bulk-update?atomic=true")
            .auth(USER, token, { type: "basic" })
            .send({ items: [ { noteId: 123, content: "<p>bad</p>" } ] })
            .expect(400);

        const nonStringResp = await supertest(app)
            .post("/etapi/notes/bulk-update")
            .auth(USER, token, { type: "basic" })
            .send({ items: [ { noteId: { bad: true }, content: "<p>bad</p>" } ] })
            .expect(200);
        expect(nonStringResp.body.failed).toStrictEqual(1);
        expect(nonStringResp.body.errors[0].noteId).toStrictEqual("unknown");
    });

    it("rejects oversized content upfront without scheduling pictures for deletion", async () => {
        const noteId = await createNote(app, token);
        const attRes = await supertest(app)
            .post("/etapi/attachments")
            .auth(USER, token, { type: "basic" })
            .send({
                ownerId: noteId,
                role: "image",
                mime: "image/png",
                title: "existing.png",
                content: "image-data"
            })
            .expect(201);

        const attachmentId = attRes.body.attachmentId;
        const attachment = becca.getAttachmentOrThrow(attachmentId);
        expect(attachment.utcDateScheduledForErasureSince).toBeNull();

        const core = await import("@triliumnext/core");
        const spy = vi.spyOn(core, "exceedsBlobContentLimit").mockReturnValue(true);

        try {
            const res = await supertest(app)
                .post("/etapi/notes/bulk-update?skipFts=true")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId, content: "<p>Text omitting the image</p>" }
                    ]
                })
                .expect(200);

            expect(res.body.failed).toBe(1);
            expect(res.body.errors[0].error).toContain("Content exceeds maximum blob length");

            // Attachment must NOT have been scheduled for deletion
            const reloadedAtt = becca.getAttachmentOrThrow(attachmentId);
            expect(reloadedAtt.utcDateScheduledForErasureSince).toBeNull();

            const { getSql } = await import("@triliumnext/core");
            const dbRow = (getSql() as any).getRow("SELECT utcDateScheduledForErasureSince FROM attachments WHERE attachmentId = ?", [attachmentId]);
            expect(dbRow?.utcDateScheduledForErasureSince).toBeNull();
        } finally {
            spy.mockRestore();
        }
    });

    it("preserves previous pending post-processing when the same note succeeds then fails in atomic=false", async () => {
        const noteId1 = await createNote(app, token);
        const postProcessSpy = vi.spyOn(noteService, "asyncPostProcessContent");

        let calls = 0;
        const spy = vi.spyOn(noteService, "saveRevisionIfNeeded").mockImplementation((note) => {
            if (note.noteId === noteId1 && ++calls > 1) {
                throw new Error("Simulated failure on second update of note 1");
            }
        });

        try {
            const firstContent = "<p>First successful content</p>";
            const res = await supertest(app)
                .post("/etapi/notes/bulk-update")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId: noteId1, content: firstContent },
                        { noteId: noteId1, content: "<p>Second failing content</p>" }
                    ]
                })
                .expect(200);

            expect(res.body.updated).toBe(1);
            expect(res.body.failed).toBe(1);

            const get1 = await supertest(app)
                .get(`/etapi/notes/${noteId1}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get1.text).toBe(firstContent);

            expect(postProcessSpy).toHaveBeenCalledWith(
                expect.objectContaining({ noteId: noteId1 }),
                firstContent
            );
        } finally {
            spy.mockRestore();
            postProcessSpy.mockRestore();
        }
    });

    it("rejects oversized content upfront with 400 in atomic mode", async () => {
        const noteId = await createNote(app, token);
        const core = await import("@triliumnext/core");
        const spy = vi.spyOn(core, "exceedsBlobContentLimit").mockReturnValue(true);

        try {
            await supertest(app)
                .post("/etapi/notes/bulk-update?atomic=true")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId, content: "<p>Huge content</p>" }
                    ]
                })
                .expect(400);
        } finally {
            spy.mockRestore();
        }
    });

    it("rolls back database and attachment changes for individual failed item in atomic=false", async () => {
        const noteId1 = await createNote(app, token);
        const noteId2 = await createNote(app, token);

        const attRes = await supertest(app)
            .post("/etapi/attachments")
            .auth(USER, token, { type: "basic" })
            .send({
                ownerId: noteId2,
                role: "image",
                mime: "image/png",
                title: "existing.png",
                content: "image-data"
            })
            .expect(201);

        const attachmentId = attRes.body.attachmentId;
        const attachment = becca.getAttachmentOrThrow(attachmentId);
        expect(attachment.utcDateScheduledForErasureSince).toBeNull();

        const initialContent2 = (await supertest(app)
            .get(`/etapi/notes/${noteId2}/content`)
            .auth(USER, token, { type: "basic" })
            .expect(200)).text;

        const spy = vi.spyOn(noteService, "saveRevisionIfNeeded").mockImplementation((note) => {
            if (note.noteId === noteId2) {
                throw new Error("Simulated disk error on note 2");
            }
        });

        try {
            const res = await supertest(app)
                .post("/etapi/notes/bulk-update?skipFts=true")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId: noteId1, content: "<p>Note 1 updated successfully</p>" },
                        { noteId: noteId2, content: "<p>Text omitting the image</p>" }
                    ]
                })
                .expect(200);

            expect(res.body.updated).toBe(1);
            expect(res.body.failed).toBe(1);

            const get1 = await supertest(app)
                .get(`/etapi/notes/${noteId1}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get1.text).toBe("<p>Note 1 updated successfully</p>");

            const get2 = await supertest(app)
                .get(`/etapi/notes/${noteId2}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get2.text).toBe(initialContent2);

            const reloadedAtt = becca.getAttachmentOrThrow(attachmentId);
            expect(reloadedAtt.utcDateScheduledForErasureSince).toBeNull();

            const { getSql } = await import("@triliumnext/core");
            const dbRow = (getSql() as any).getRow("SELECT utcDateScheduledForErasureSince FROM attachments WHERE attachmentId = ?", [attachmentId]);
            expect(dbRow?.utcDateScheduledForErasureSince).toBeNull();
        } finally {
            spy.mockRestore();
        }
    });

    it("preserves successful items' entity changes and sends updates to clients when an individual item fails in atomic=false with real transaction hooks", async () => {
        const noteId1 = await createNote(app, token);
        const noteId2 = await createNote(app, token);

        const { getSql, ws, cls, becca_loader, entity_changes } = await import("@triliumnext/core");
        const { initMessaging } = await import("@triliumnext/core/src/services/messaging/index.js");
        const realSql = getSql();

        const originalParams = (realSql as any).params;
        const sentMessages: any[] = [];
        const mockMessaging = {
            sendMessageToAllClients: (msg: any) => {
                sentMessages.push(msg);
            },
            sendMessageToClient: () => true,
            setClientMessageHandler: () => {}
        };
        initMessaging(mockMessaging as any);
        ws.init();

        // Real transaction hooks matching core_init.ts
        const realCommit = () => {
            ws.sendTransactionEntityChangesToAllClients();
        };
        const realRollback = () => {
            const entityChangeIds = cls.getAndClearEntityChangeIds();
            if (entityChangeIds.length > 0) {
                becca_loader.load();
            }
            entity_changes.recalculateMaxEntityChangeId();
        };

        (realSql as any).params = {
            ...originalParams,
            onTransactionCommit: realCommit,
            onTransactionRollback: realRollback
        };

        const spy = vi.spyOn(noteService, "saveRevisionIfNeeded").mockImplementation((note) => {
            if (note.noteId === noteId2) {
                throw new Error("Simulated disk error on note 2");
            }
        });

        try {
            const res = await supertest(app)
                .post("/etapi/notes/bulk-update")
                .auth(USER, token, { type: "basic" })
                .send({
                    items: [
                        { noteId: noteId1, content: "<p>Note 1 updated</p>" },
                        { noteId: noteId2, content: "<p>Note 2 failed</p>" }
                    ]
                })
                .expect(200);

            expect(res.body.updated).toBe(1);
            expect(res.body.failed).toBe(1);

            const get1 = await supertest(app)
                .get(`/etapi/notes/${noteId1}/content`)
                .auth(USER, token, { type: "basic" })
                .expect(200);
            expect(get1.text).toBe("<p>Note 1 updated</p>");

            expect(sentMessages.length).toBeGreaterThan(0);
            const allEntityChanges = sentMessages.flatMap((m) => m.data?.entityChanges || []);
            expect(allEntityChanges.some((c: any) => c.entityId === noteId1)).toBe(true);
            expect(allEntityChanges.some((c: any) => c.entityId === noteId2)).toBe(false);

            const maxChangeIdInDb = (realSql as any).getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
            expect(entity_changes.getMaxEntityChangeId()).toBe(maxChangeIdInDb);
        } finally {
            spy.mockRestore();
            (realSql as any).params = originalParams;
        }
    });
});
