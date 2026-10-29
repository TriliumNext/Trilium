import { becca, cls, events, getZipProvider, initContentJobExecutor, note_service, password_encryption, protected_session, TaskContext } from "@triliumnext/core";
import { createHash } from "crypto";
import { Application } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login, outOfOrderContentJobs } from "./utils.js";
import config from "../../src/services/config.js";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/export-note-subtree", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("export works", async () => {
        await supertest(app)
            .get("/etapi/notes/root/export")
            .auth(USER, token, { "type": "basic"})
            .expect(200)
            .expect("Content-Type", "application/zip");
    });

    it("HTML export works", async () => {
        await supertest(app)
            .get("/etapi/notes/root/export?format=html")
            .auth(USER, token, { "type": "basic"})
            .expect(200)
            .expect("Content-Type", "application/zip");
    });

    it("Markdown export works", async () => {
        await supertest(app)
            .get("/etapi/notes/root/export?format=markdown")
            .auth(USER, token, { "type": "basic"})
            .expect(200)
            .expect("Content-Type", "application/zip");
    });

    it("reports wrong format", async () => {
        const response = await supertest(app)
            .get("/etapi/notes/root/export?format=wrong")
            .auth(USER, token, { "type": "basic"})
            .expect(400);
        expect(response.body.code).toStrictEqual("UNRECOGNIZED_EXPORT_FORMAT");
    });

    describe("with conversions that finish out of order", () => {
        afterEach(() => initContentJobExecutor());

        it.each([ "html", "markdown" ])("exports the same %s archive as converting one note at a time", async (format) => {
            const expected = await exportEntries(format);

            const { executor, stats } = outOfOrderContentJobs();
            initContentJobExecutor(executor);
            const actual = await exportEntries(format);

            expect(actual).toEqual(expected);
            expect(stats.maxInFlight).toBeGreaterThan(1);
            expect(stats.finished).not.toEqual(stats.started);
        });

        /** The archive's entry names in order, each with the hash of its bytes. */
        async function exportEntries(format: string) {
            const response = await supertest(app)
                .get(`/etapi/notes/root/export?format=${format}`)
                .auth(USER, token, { "type": "basic"})
                .buffer(true)
                .parse((res, callback) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (chunk: Buffer) => chunks.push(chunk));
                    res.on("end", () => callback(null, Buffer.concat(chunks)));
                })
                .expect(200);

            const entries: string[] = [];
            await getZipProvider().readZipFile(response.body as Buffer, async (entry, readContent) => {
                entries.push(`${entry.fileName} ${createHash("sha256").update(await readContent()).digest("hex")}`);
            });
            return entries;
        }
    });

    describe("with a protected note while the protected session is open", () => {
        const SECRET_TITLE = "EtapiExportSecretTitle";
        const SECRET_CONTENT = "EtapiExportSecretContent";
        const SECRET_ATTACHMENT_TITLE = "EtapiExportSecretAttachment";
        const SECRET_ATTACHMENT_CONTENT = "EtapiExportSecretAttachmentContent";
        const SECRETS = [ SECRET_TITLE, SECRET_CONTENT, SECRET_ATTACHMENT_TITLE, SECRET_ATTACHMENT_CONTENT ];

        let hostNoteId: string;
        let secretNoteId: string;

        beforeAll(async () => {
            hostNoteId = await createNote(app, token, "<p>host body</p>");
            const created = await supertest(app)
                .post("/etapi/create-note")
                .auth(USER, token, { "type": "basic"})
                .send({ parentNoteId: hostNoteId, title: SECRET_TITLE, type: "text", content: `<p>${SECRET_CONTENT}</p>` })
                .expect(201);
            secretNoteId = created.body.note.noteId;
            await supertest(app)
                .post("/etapi/attachments")
                .auth(USER, token, { "type": "basic"})
                .send({ ownerId: secretNoteId, role: "file", mime: "text/plain", title: SECRET_ATTACHMENT_TITLE, content: SECRET_ATTACHMENT_CONTENT })
                .expect(201);

            const dataKey = await password_encryption.getDataKey("demo1234");
            if (!(dataKey instanceof Uint8Array)) {
                throw new Error("Expected a data key from the fixture password.");
            }
            protected_session.default.setDataKey(dataKey);
            cls.init(() => note_service.protectNoteRecursively(becca.getNoteOrThrow(secretNoteId), true, false,
                new TaskContext("no-progress-reporting", "protectNotes", null)));
            expect(becca.getNoteOrThrow(secretNoteId)).toMatchObject({ isProtected: true, isDecrypted: true, title: SECRET_TITLE });
        });

        afterAll(() => {
            protected_session.resetDataKey();
            events.emit(events.LEAVE_PROTECTED_SESSION);
        });

        async function exportZip(noteId: string, format: string) {
            const response = await supertest(app)
                .get(`/etapi/notes/${noteId}/export?format=${format}`)
                .auth(USER, token, { "type": "basic"})
                .buffer(true)
                .parse((res, callback) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (chunk: Buffer) => chunks.push(chunk));
                    res.on("end", () => callback(null, Buffer.concat(chunks)));
                })
                .expect(200)
                .expect("Content-Type", "application/zip");

            const texts = [ String(response.headers["content-disposition"]) ];
            await getZipProvider().readZipFile(response.body as Buffer, async (entry, readContent) => {
                texts.push(entry.fileName, Buffer.from(await readContent()).toString("utf-8"));
            });
            return { texts, leaked: SECRETS.filter((secret) => texts.some((text) => text.includes(secret))) };
        }

        it.each([ "html", "markdown" ])("leaves a protected descendant out of a %s export", async (format) => {
            const { texts, leaked } = await exportZip(hostNoteId, format);

            expect(leaked).toEqual([]);
            expect(texts.some((text) => text.includes("[protected]"))).toBe(true);
            expect(texts.some((text) => text.includes("host body"))).toBe(true);
        });

        it.each([ "html", "markdown" ])("leaves a protected export root out of a %s export", async (format) => {
            const { leaked } = await exportZip(secretNoteId, format);

            expect(leaked).toEqual([]);
        });

        it("refuses a share export of a subtree that holds a protected note", async () => {
            for (const noteId of [ hostNoteId, secretNoteId ]) {
                const response = await supertest(app)
                    .get(`/etapi/notes/${noteId}/export?format=share`)
                    .auth(USER, token, { "type": "basic"})
                    .expect(400);
                expect(response.body).toMatchObject({ code: "NOTE_IS_PROTECTED", message: expect.stringContaining(secretNoteId) });
            }
        });
    });
});
