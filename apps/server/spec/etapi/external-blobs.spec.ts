import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import sql from "../../src/services/sql.js";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/external-blobs", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        config.ExternalBlobStorage.enabled = true;
        config.ExternalBlobStorage.thresholdBytes = 10;

        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
        token = await login(app);
    });

    it("stores small note content internally", async () => {
        const payload = "a".repeat(10);
        const createRes = await supertest(app)
            .post("/etapi/create-note")
            .auth(USER, token, { "type": "basic"})
            .send({
                "parentNoteId": "root",
                "title": "Internal Blob Test",
                "mime": "text/plain",
                "type": "text",
                "content": payload
            })
            .expect(201);

        const createdNoteId: string = createRes.body.note.noteId;
        expect(createdNoteId).toBeTruthy();

        const blobId = sql.getValue<string>("SELECT blobId FROM notes WHERE noteId = ?", [createdNoteId]);
        expect(blobId).toBeTruthy();

        const row = sql.getRow<{ contentLocation: string; content: string | null; contentLength: number }>(
            "SELECT contentLocation, content, contentLength FROM blobs WHERE blobId = ?",
            [blobId]
        );

        expect(row).toBeTruthy();
        expect(row.contentLength).toEqual(payload.length);
        expect(row.contentLocation).toEqual("internal");
        expect(row.content).toEqual(payload);
    });

    it("stores large note content externally and serves it back", async () => {
        const payload = "a".repeat(11);
        const createRes = await supertest(app)
            .post("/etapi/create-note")
            .auth(USER, token, { "type": "basic"})
            .send({
                "parentNoteId": "root",
                "title": "External Blob Test",
                "mime": "application/octet-stream",
                "type": "file",
                "content": payload
            })
            .expect(201);

        const createdNoteId: string = createRes.body.note.noteId;
        expect(createdNoteId).toBeTruthy();

        const blobId = sql.getValue<string>("SELECT blobId FROM notes WHERE noteId = ?", [createdNoteId]);
        expect(blobId).toBeTruthy();

        const row = sql.getRow<{ contentLocation: string; content: string | null; contentLength: number }>(
            "SELECT contentLocation, content, contentLength FROM blobs WHERE blobId = ?",
            [blobId]
        );

        expect(row).toBeTruthy();
        expect(row.contentLength).toEqual(payload.length);
        expect(row.contentLocation.startsWith("file://")).toBe(true);
        expect(row.content).toBeNull();

        const getRes = await supertest(app)
            .get(`/etapi/notes/${createdNoteId}/content`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);

        expect(getRes.body.toString()).toEqual(payload);
    });
});


