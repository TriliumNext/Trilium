import { search as searchService } from "@triliumnext/core";
import { Application } from "express";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";
import { randomUUID } from "crypto";

let app: Application;
let token: string;

const USER = "etapi";
let content: string;

describe("etapi/search", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);

        content = randomUUID();
        await createNote(app, token, content);
    });

    it("finds by content", async () => {
        const response = await supertest(app)
            .get(`/etapi/notes?search=${content}&debug=true`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body.results).toHaveLength(1);
    });

    it("does not find by content when fast search is on", async () => {
        const response = await supertest(app)
            .get(`/etapi/notes?search=${content}&debug=true&fastSearch=true`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);
        expect(response.body.results).toHaveLength(0);
    });

    it("attribute = uses strict equality, not word/phrase matching", async () => {
        // Regression for #9422: "#capital=Vienna" must match the note whose label
        // value equals "Vienna" exactly, and must NOT match one whose value merely
        // contains the word "Vienna" (e.g. "Vienna Austria").
        const exactNoteId = await createNoteWithLabel(app, token, "capital", "Vienna");
        await createNoteWithLabel(app, token, "capital", "Vienna Austria");

        const query = encodeURIComponent("#capital=Vienna");
        const response = await supertest(app)
            .get(`/etapi/notes?search=${query}`)
            .auth(USER, token, { "type": "basic"})
            .expect(200);

        const resultIds = response.body.results.map((r: { noteId: string }) => r.noteId);
        expect(resultIds).toStrictEqual([exactNoteId]);
    });

    describe("query parameter handling", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("rejects a missing search query parameter", async () => {
            const response = await supertest(app)
                .get("/etapi/notes")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("SEARCH_QUERY_PARAM_MANDATORY");
        });

        it("accepts string, order and integer parameters", async () => {
            await supertest(app)
                .get("/etapi/notes?search=root&ancestorNoteId=root&orderBy=title&orderDirection=asc&limit=5&includeArchivedNotes=true")
                .auth(USER, token, { "type": "basic"})
                .expect(200);
        });

        it("rejects a non-boolean flag", async () => {
            const response = await supertest(app)
                .get("/etapi/notes?search=root&fastSearch=maybe")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("SEARCH_PARAM_VALIDATION_ERROR");
        });

        it("rejects an invalid order direction", async () => {
            const response = await supertest(app)
                .get("/etapi/notes?search=root&orderDirection=sideways")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("SEARCH_PARAM_VALIDATION_ERROR");
        });

        it("rejects a non-integer limit", async () => {
            const response = await supertest(app)
                .get("/etapi/notes?search=root&limit=lots")
                .auth(USER, token, { "type": "basic"})
                .expect(400);
            expect(response.body.code).toStrictEqual("SEARCH_PARAM_VALIDATION_ERROR");
        });

        it("reports a generic 500 when the search service throws", async () => {
            vi.spyOn(searchService, "findResultsWithQuery").mockImplementation(() => {
                throw new Error("boom");
            });
            const response = await supertest(app)
                .get("/etapi/notes?search=root")
                .auth(USER, token, { "type": "basic"})
                .expect(500);
            expect(response.body.code).toStrictEqual("GENERIC");
        });
    });
});

async function createNoteWithLabel(app: Application, token: string, name: string, value: string) {
    const noteId = await createNote(app, token, randomUUID());
    const attributeId = `label${randomUUID().replace(/-/g, "")}`.substring(0, 32);

    await supertest(app)
        .post("/etapi/attributes")
        .auth(USER, token, { "type": "basic" })
        .send({ attributeId, noteId, type: "label", name, value })
        .expect(201);

    return noteId;
}
